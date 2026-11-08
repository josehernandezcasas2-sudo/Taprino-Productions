// The fake Clerk on :54323 — the Backend API the server reaches through
// CLERK_API_URL (@clerk/backend builds `${CLERK_API_URL}/v1/...`), over
// in-memory users loaded from seed/accounts.json:
//   GET  /v1/jwks                          the rig's session key (kid rig-test)
//   GET  /v1/users  (user_id, email_address, username, query, limit,
//                    offset, order_by)     → array
//   GET  /v1/users/count                   → { object: total_count }
//   GET/PATCH/DELETE /v1/users/:id, PATCH /v1/users/:id/metadata (merge),
//   POST /v1/users
//   GET/POST /v1/invitations, POST /v1/invitations/:id/revoke
// Test hooks (no auth):
//   GET  /__state, POST /__reset (back to the seed file)
//   POST /__users/:id  { role, permissions, twoFactorEnabled,
//                        publicMetadata, privateMetadata, banned, ... }
//   POST /__roles?user=&role=[&permissions=a,b]   POST /__twofactor?user=&on=1
//   POST /__users  { id?, email, firstName, ... }  (a new account)
//   POST /__expo/push/send                 sink for EXPO_PUSH_URL
// Anything else answers Clerk's 404 shape.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PORTS, HOST, RIG_DIR, FAKE_KEYS } from '../lib/config.mjs';
import { loadKeys } from '../lib/keys.mjs';
import { publicJwk, signRS256 } from '../lib/jwt.mjs';
import { readBody, sendJson, jsonOrNull, logLine, listen, corsHeaders } from '../lib/http.mjs';
import { resolveUserId } from '../lib/accounts.mjs';

const keys = loadKeys();
const SEED = path.join(RIG_DIR, 'seed', 'accounts.json');
const DAY = 86400000;

let users = new Map();
let invitations = new Map();
const pushes = [];

function emailObj(id, address, verified = true) {
  return {
    id,
    object: 'email_address',
    email_address: address,
    reserved: false,
    verification: verified ? { status: 'verified', strategy: 'email_code', attempts: null, expire_at: null } : { status: 'unverified', strategy: 'email_code', attempts: null, expire_at: null },
    linked_to: [],
    matches_sso_connection: false,
    created_at: Date.now(),
    updated_at: Date.now()
  };
}

function makeUser(a) {
  const now = Date.now();
  const created = now - (Number(a.createdDaysAgo) || 30) * DAY;
  const emailId = `idn_${(a.id || '').replace(/^user_/, '')}Email`;
  const meta = { ...(a.publicMetadata || {}) };
  if (a.role) meta.role = a.role;
  if (Array.isArray(a.permissions)) meta.permissions = a.permissions;
  return {
    object: 'user',
    id: a.id,
    username: a.username || null,
    first_name: a.firstName || null,
    last_name: a.lastName || null,
    image_url: `http://${HOST}:${PORTS.clerk}/__avatar/${a.id}`,
    has_image: false,
    primary_email_address_id: a.email ? emailId : null,
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: Boolean(a.twoFactorEnabled),
    totp_enabled: Boolean(a.twoFactorEnabled),
    backup_code_enabled: false,
    email_addresses: a.email ? [emailObj(emailId, a.email, a.emailVerified !== false)] : [],
    phone_numbers: [],
    web3_wallets: [],
    passkeys: [],
    external_accounts: [],
    saml_accounts: [],
    enterprise_accounts: [],
    public_metadata: meta,
    private_metadata: { ...(a.privateMetadata || {}) },
    unsafe_metadata: {},
    external_id: null,
    last_sign_in_at: now - DAY,
    banned: Boolean(a.banned),
    locked: false,
    lockout_expires_in_seconds: null,
    verification_attempts_remaining: 100,
    created_at: created,
    updated_at: created,
    delete_self_enabled: true,
    create_organization_enabled: true,
    create_organizations_limit: null,
    last_active_at: now - DAY,
    legal_accepted_at: null,
    locale: null
  };
}

function loadSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  users = new Map(seed.accounts.map((a) => [a.id, makeUser(a)]));
  invitations = new Map();
  pushes.length = 0;
}
loadSeed();

const clerkError = (res, status, code, message, longMessage) => sendJson(res, status, { errors: [{ code, message, long_message: longMessage || message, meta: {} }], clerk_trace_id: crypto.randomUUID() });

// Clerk merges metadata deeply; a key set to null is removed.
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function primaryEmail(u) {
  const e = u.email_addresses.find((x) => x.id === u.primary_email_address_id) || u.email_addresses[0];
  return e ? e.email_address : '';
}

function filterUsers(q) {
  let list = [...users.values()];
  const ids = q.getAll('user_id');
  if (ids.length) list = list.filter((u) => ids.includes(u.id));
  const emails = q.getAll('email_address').map((e) => e.toLowerCase());
  if (emails.length) list = list.filter((u) => u.email_addresses.some((e) => emails.includes(e.email_address.toLowerCase())));
  const names = q.getAll('username').map((e) => e.toLowerCase());
  if (names.length) list = list.filter((u) => u.username && names.includes(u.username.toLowerCase()));
  const ext = q.getAll('external_id');
  if (ext.length) list = list.filter((u) => ext.includes(u.external_id));
  const query = (q.get('query') || '').toLowerCase();
  if (query) {
    list = list.filter((u) => [u.id, u.username, u.first_name, u.last_name, ...u.email_addresses.map((e) => e.email_address)].filter(Boolean).some((s) => String(s).toLowerCase().includes(query)));
  }
  const order = q.get('order_by') || '-created_at';
  const desc = order.startsWith('-');
  const field = order.replace(/^[-+]/, '');
  const val = (u) => (field === 'email_address' ? primaryEmail(u) : u[field] ?? '');
  list.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
  return list;
}

function applyUserPatch(u, body) {
  const map = { first_name: 'first_name', last_name: 'last_name', username: 'username', external_id: 'external_id' };
  for (const [k, field] of Object.entries(map)) if (body[k] !== undefined) u[field] = body[k];
  if (body.public_metadata !== undefined) u.public_metadata = body.public_metadata || {};
  if (body.private_metadata !== undefined) u.private_metadata = body.private_metadata || {};
  if (body.unsafe_metadata !== undefined) u.unsafe_metadata = body.unsafe_metadata || {};
  if (body.primary_email_address_id !== undefined) u.primary_email_address_id = body.primary_email_address_id;
  u.updated_at = Date.now();
  return u;
}

function invitationList(q) {
  let list = [...invitations.values()];
  const status = q.get('status');
  if (status) list = list.filter((i) => i.status === status);
  const query = (q.get('query') || '').toLowerCase();
  if (query) list = list.filter((i) => i.email_address.toLowerCase().includes(query));
  list.sort((a, b) => b.created_at - a.created_at);
  return list;
}

// Test hook body → user changes, in the words the rig's README uses.
function applyHook(u, b) {
  if (b.role !== undefined) {
    if (b.role) u.public_metadata = { ...u.public_metadata, role: b.role };
    else {
      const { role, ...rest } = u.public_metadata;
      void role;
      u.public_metadata = rest;
    }
  }
  if (b.permissions !== undefined) u.public_metadata = { ...u.public_metadata, permissions: b.permissions };
  if (b.twoFactorEnabled !== undefined) {
    u.two_factor_enabled = Boolean(b.twoFactorEnabled);
    u.totp_enabled = Boolean(b.twoFactorEnabled);
  }
  if (b.publicMetadata) u.public_metadata = deepMerge(u.public_metadata, b.publicMetadata);
  if (b.privateMetadata) u.private_metadata = deepMerge(u.private_metadata, b.privateMetadata);
  if (b.banned !== undefined) u.banned = Boolean(b.banned);
  if (b.createdDaysAgo !== undefined) u.created_at = Date.now() - Number(b.createdDaysAgo) * DAY;
  if (b.emailVerified !== undefined) for (const e of u.email_addresses) e.verification.status = b.emailVerified ? 'verified' : 'unverified';
  if (b.firstName !== undefined) u.first_name = b.firstName;
  if (b.lastName !== undefined) u.last_name = b.lastName;
  u.updated_at = Date.now();
  return u;
}

function sessionCookie(userId, minutes = 60) {
  const now = Math.floor(Date.now() / 1000);
  const token = signRS256({ sub: userId, sid: `sess_rig_${userId}`, iat: now - 5, nbf: now - 10, exp: now + minutes * 60, iss: 'https://clerk.example.com', azp: `http://${HOST}:${PORTS.next}` }, keys.clerkPrivatePem, FAKE_KEYS.clerkKid);
  return { token, cookie: `__session=${token}; __client_uat=1700000000; __clerk_db_jwt=dvb_rig_${userId}` };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => logLine('clerk', `${req.method} ${req.url.slice(0, 300)} ${res.statusCode} ${Date.now() - started}ms`));
  try {
    const url = new URL(req.url, 'http://local');
    const q = url.searchParams;
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : jsonOrNull(await readBody(req)) || {};

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    // ---- hooks ----
    if (p === '/__health') return sendJson(res, 200, { ok: true, users: users.size });
    if (seg[0] === '__avatar') {
      const u = users.get(seg[1]);
      const letter = ((u && (u.first_name || u.username)) || '?').slice(0, 1).toUpperCase();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#2b2f3a"/><text x="64" y="84" font-size="64" font-family="sans-serif" fill="#ff8c42" text-anchor="middle">${letter}</text></svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(svg) });
      return res.end(svg);
    }
    if (p === '/__state') return sendJson(res, 200, { users: [...users.values()], invitations: [...invitations.values()], pushes });
    if (p === '/__reset' && req.method === 'POST') {
      loadSeed();
      return sendJson(res, 200, { ok: true, users: users.size });
    }
    if (p === '/__session') {
      const id = resolveUserId(q.get('user'));
      if (!users.has(id)) return sendJson(res, 404, { error: `no user ${id}` });
      return sendJson(res, 200, sessionCookie(id, Number(q.get('minutes') || 60)));
    }
    if (p === '/__roles' && req.method === 'POST') {
      const u = users.get(resolveUserId(q.get('user')));
      if (!u) return sendJson(res, 404, { error: 'no such user' });
      applyHook(u, { role: q.get('role') || null, ...(q.has('permissions') ? { permissions: q.get('permissions').split(',').filter(Boolean) } : {}) });
      return sendJson(res, 200, { ok: true, publicMetadata: u.public_metadata });
    }
    if (p === '/__twofactor' && req.method === 'POST') {
      const u = users.get(resolveUserId(q.get('user')));
      if (!u) return sendJson(res, 404, { error: 'no such user' });
      applyHook(u, { twoFactorEnabled: q.get('on') === '1' || q.get('on') === 'true' });
      return sendJson(res, 200, { ok: true, twoFactorEnabled: u.two_factor_enabled });
    }
    if (seg[0] === '__users' && req.method === 'POST') {
      if (seg[1]) {
        const u = users.get(resolveUserId(seg[1]));
        if (!u) return sendJson(res, 404, { error: 'no such user' });
        return sendJson(res, 200, applyHook(u, body));
      }
      const id = body.id || `user_rig${crypto.randomBytes(5).toString("hex")}`;
      const u = makeUser({ ...body, id });
      users.set(id, u);
      return sendJson(res, 200, u);
    }
    if (p === '/__expo/push/send' && req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      pushes.push(...list.map((m) => ({ at: new Date().toISOString(), ...m })));
      if (pushes.length > 500) pushes.splice(0, pushes.length - 500);
      return sendJson(res, 200, { data: list.map(() => ({ status: 'ok', id: crypto.randomUUID() })) });
    }

    // ---- Backend API ----
    if (seg[0] !== 'v1') return clerkError(res, 404, 'resource_not_found', `The fake Clerk has no ${req.method} ${p}`);
    const auth = String(req.headers.authorization || '');
    if (seg[1] !== 'jwks' && auth !== `Bearer ${FAKE_KEYS.clerkSecret}`) return clerkError(res, 401, 'authentication_invalid', 'Unauthorized request', 'The provided Clerk Secret Key is invalid.');

    if (seg[1] === 'jwks' && req.method === 'GET') return sendJson(res, 200, { keys: [publicJwk(keys.clerkPublicPem, FAKE_KEYS.clerkKid)] });

    if (seg[1] === 'users') {
      if (seg.length === 2 && req.method === 'GET') {
        const list = filterUsers(q);
        const offset = Number(q.get('offset') || 0);
        const limit = Math.min(Number(q.get('limit') || 10), 500);
        return sendJson(res, 200, list.slice(offset, offset + limit));
      }
      if (seg[2] === 'count' && req.method === 'GET') return sendJson(res, 200, { object: 'total_count', total_count: filterUsers(q).length });
      if (seg.length === 2 && req.method === 'POST') {
        const id = `user_rig${crypto.randomBytes(6).toString("hex")}`;
        const email = Array.isArray(body.email_address) ? body.email_address[0] : body.email_address;
        if (email && [...users.values()].some((u) => u.email_addresses.some((e) => e.email_address.toLowerCase() === String(email).toLowerCase()))) {
          return clerkError(res, 422, 'form_identifier_exists', 'That email address is taken. Please try another.');
        }
        const u = makeUser({ id, email, firstName: body.first_name, lastName: body.last_name, username: body.username, publicMetadata: body.public_metadata, privateMetadata: body.private_metadata, createdDaysAgo: 0 });
        users.set(id, u);
        return sendJson(res, 200, u);
      }
      const u = users.get(seg[2]);
      if (!u) return clerkError(res, 404, 'resource_not_found', 'not found', `User ${seg[2]} not found`);
      if (seg.length === 3 && req.method === 'GET') return sendJson(res, 200, u);
      if (seg.length === 3 && req.method === 'PATCH') return sendJson(res, 200, applyUserPatch(u, body));
      if (seg.length === 3 && req.method === 'DELETE') {
        users.delete(u.id);
        return sendJson(res, 200, { object: 'user', id: u.id, deleted: true });
      }
      if (seg[3] === 'metadata' && req.method === 'PATCH') {
        if (body.public_metadata !== undefined) u.public_metadata = deepMerge(u.public_metadata, body.public_metadata);
        if (body.private_metadata !== undefined) u.private_metadata = deepMerge(u.private_metadata, body.private_metadata);
        if (body.unsafe_metadata !== undefined) u.unsafe_metadata = deepMerge(u.unsafe_metadata, body.unsafe_metadata);
        u.updated_at = Date.now();
        return sendJson(res, 200, u);
      }
    }

    if (seg[1] === 'invitations') {
      if (seg.length === 2 && req.method === 'GET') {
        const list = invitationList(q);
        const offset = Number(q.get('offset') || 0);
        const limit = Math.min(Number(q.get('limit') || 10), 500);
        const page = list.slice(offset, offset + limit);
        return q.get('paginated') === 'true' ? sendJson(res, 200, { data: page, total_count: list.length }) : sendJson(res, 200, page);
      }
      if (seg.length === 2 && req.method === 'POST') {
        const email = String(body.email_address || '').trim();
        if (!email) return clerkError(res, 422, 'form_param_missing', 'email_address must be included.');
        if (!body.ignore_existing && [...users.values()].some((u) => u.email_addresses.some((e) => e.email_address.toLowerCase() === email.toLowerCase()))) {
          return clerkError(res, 422, 'form_identifier_exists', 'That email address is taken. Please try another.');
        }
        if (!body.ignore_existing && [...invitations.values()].some((i) => i.status === 'pending' && i.email_address.toLowerCase() === email.toLowerCase())) {
          return clerkError(res, 400, 'duplicate_record', 'There are already pending invitations for the following email addresses: ' + email);
        }
        const now = Date.now();
        const id = `inv_rig_${crypto.randomBytes(8).toString('hex')}`;
        const inv = { object: 'invitation', id, email_address: email, public_metadata: body.public_metadata || {}, created_at: now, updated_at: now, status: 'pending', url: `${body.redirect_url || 'http://127.0.0.1:3100/welcome'}?__clerk_ticket=rig_${id}`, revoked: false, expires_at: now + 30 * DAY };
        invitations.set(id, inv);
        return sendJson(res, 200, inv);
      }
      if (seg[3] === 'revoke' && req.method === 'POST') {
        const inv = invitations.get(seg[2]);
        if (!inv) return clerkError(res, 404, 'resource_not_found', 'not found', `Invitation ${seg[2]} not found`);
        if (inv.status !== 'pending') return clerkError(res, 400, 'invitation_not_pending', 'Only pending invitations can be revoked.');
        inv.status = 'revoked';
        inv.revoked = true;
        inv.updated_at = Date.now();
        return sendJson(res, 200, inv);
      }
    }

    return clerkError(res, 404, 'resource_not_found', `The fake Clerk does not implement ${req.method} ${p}`);
  } catch (err) {
    console.error('fake clerk error:', err);
    if (!res.headersSent) sendJson(res, 500, { errors: [{ code: 'internal', message: err.message }] });
  }
});

await listen(server, PORTS.clerk, HOST, 'fake Clerk');
