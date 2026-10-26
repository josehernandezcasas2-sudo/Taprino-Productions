import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from './supabase';
import { SITE } from './siteConfig';
import { sendEmail } from './notify';
import { REQUEST_KINDS } from './privateBetaRules';

// Private beta (migration 098): the server side of /admin/invites and the
// door's request form. Invitations are Clerk's — creating one emails the
// address a link (Clerk's own "Invitation" template, editable in the
// Clerk dashboard) that lands on /welcome?__clerk_ticket=…, where the
// SignUp box creates the account; while the instance's sign-up mode is
// Restricted that ticket is the only way in. Our own table only holds
// the requests people leave at the door and the note an admin wrote.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 200 ? email : null;
}

// The link in Clerk's invitation email. Must be the www host: the apex
// 308-redirects and the ticket should survive untouched.
export function invitationRedirectUrl() {
  const base = process.env.PRIVATE_BETA_WELCOME_URL || 'https://www.studiotapatv.site/welcome';
  return base;
}

function missingTable(error) {
  return error && /relation .* does not exist|schema cache|Could not find the table/i.test(error.message || '');
}

// ---- Requests (the door) ----

export async function saveRequest({ email, kind, note }) {
  const clean = cleanEmail(email);
  if (!clean) {
    const err = new Error('That doesn’t look like an email address.');
    err.status = 400;
    throw err;
  }
  const k = REQUEST_KINDS.some((r) => r.value === kind) ? kind : 'viewer';
  const supabase = getSupabase();
  const { data: existing, error: readErr } = await supabase.from('beta_requests').select('id, status').eq('email', clean).maybeSingle();
  if (readErr) {
    if (missingTable(readErr)) {
      const err = new Error('The invite list isn’t set up yet (migration 098).');
      err.status = 503;
      throw err;
    }
    throw readErr;
  }
  if (existing) {
    // Asking twice keeps one row; a dismissed one comes back as waiting
    // so a second ask isn't silently swallowed.
    const { error } = await supabase.from('beta_requests').update({
      kind: k,
      note: note ? String(note).trim().slice(0, 600) : null,
      status: existing.status === 'invited' ? 'invited' : 'waiting',
      updated_at: new Date().toISOString()
    }).eq('id', existing.id);
    if (error) throw error;
    // The same answer as a first ask, so the door can't be used to check
    // whether an address is already on the list (security round, 2026-10-26).
    return { ok: true };
  }
  const { error } = await supabase.from('beta_requests').insert({
    email: clean,
    kind: k,
    note: note ? String(note).trim().slice(0, 600) : null
  });
  if (error) throw error;
  // A heads-up to the studio inbox, best effort; the row is what counts.
  const kindLabel = (REQUEST_KINDS.find((r) => r.value === k) || REQUEST_KINDS[0]).label;
  sendEmail({
    to: process.env.PRIVATE_BETA_NOTIFY_EMAIL || SITE.contactEmail,
    subject: `Invite request: ${clean} (${kindLabel})`,
    html: `<p><strong>${esc(clean)}</strong> asked for an invite to ${esc(SITE.name)} as: ${esc(kindLabel)}.</p>${note ? `<p>${esc(String(note).slice(0, 600))}</p>` : ''}<p><a href="${SITE.productionDomain}/admin/invites">Open the Invites page</a></p>`
  }).catch(() => {});
  return { ok: true, repeat: false };
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- The admin page ----

function invitationView(inv, requestByEmail) {
  const email = String(inv.emailAddress || '').toLowerCase();
  const req = requestByEmail.get(email);
  return {
    id: inv.id,
    email,
    status: inv.status || 'pending', // pending | accepted | revoked
    createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString() : null,
    updatedAt: inv.updatedAt ? new Date(inv.updatedAt).toISOString() : null,
    note: req && req.admin_note ? req.admin_note : null,
    kind: req ? req.kind : null
  };
}

export async function getInvitesPage() {
  const supabase = getSupabase();
  const { data: requests, error } = await supabase.from('beta_requests').select('*').order('created_at', { ascending: false }).limit(500);
  if (error && !missingTable(error)) throw error;
  const rows = error ? [] : (requests || []);
  const byEmail = new Map(rows.map((r) => [r.email, r]));

  let invitations = [];
  let clerkError = null;
  try {
    const client = await clerkClient();
    // Newest first, up to 500: plenty for a beta list.
    const page = await client.invitations.getInvitationList({ limit: 500 });
    invitations = (page && page.data ? page.data : (Array.isArray(page) ? page : [])).map((inv) => invitationView(inv, byEmail));
    invitations.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    clerkError = err.message || 'Clerk did not answer.';
  }

  return {
    available: !error,
    clerkError,
    invitations,
    requests: rows.map((r) => ({
      id: r.id,
      email: r.email,
      kind: r.kind,
      kindLabel: (REQUEST_KINDS.find((k) => k.value === r.kind) || REQUEST_KINDS[0]).label,
      note: r.note,
      status: r.status,
      createdAt: r.created_at,
      decidedAt: r.decided_at
    })),
    counts: {
      sent: invitations.length,
      joined: invitations.filter((i) => i.status === 'accepted').length,
      pending: invitations.filter((i) => i.status === 'pending').length,
      waiting: rows.filter((r) => r.status === 'waiting').length
    }
  };
}

// Send one invitation. `ignoreExisting` lets an address that already has
// an account or a pending invitation through without a 422 — Clerk then
// returns the existing invitation or creates a fresh one as it sees fit.
async function createOne(client, email) {
  return client.invitations.createInvitation({
    emailAddress: email,
    redirectUrl: invitationRedirectUrl(),
    notify: true,
    ignoreExisting: true
  });
}

export async function inviteEmails({ emails, note, adminId }) {
  const list = [...new Set((emails || []).map(cleanEmail).filter(Boolean))].slice(0, 50);
  if (list.length === 0) {
    const err = new Error('No valid email addresses.');
    err.status = 400;
    throw err;
  }
  const client = await clerkClient();
  const supabase = getSupabase();
  const sent = [];
  const failed = [];
  for (const email of list) {
    try {
      const inv = await createOne(client, email);
      sent.push({ email, id: inv.id });
      // Remember the note and close the request, if there was one.
      const patch = {
        status: 'invited',
        invitation_id: inv.id,
        admin_note: note ? String(note).trim().slice(0, 300) : null,
        decided_at: new Date().toISOString(),
        decided_by: adminId || null,
        updated_at: new Date().toISOString()
      };
      const { data: existing, error: readErr } = await supabase.from('beta_requests').select('id').eq('email', email).maybeSingle();
      if (!readErr) {
        if (existing) await supabase.from('beta_requests').update(patch).eq('id', existing.id);
        else if (note) await supabase.from('beta_requests').insert({ email, kind: 'viewer', ...patch });
      }
    } catch (err) {
      const msg = (err && err.errors && err.errors[0] && (err.errors[0].longMessage || err.errors[0].message)) || err.message || 'Clerk refused it.';
      failed.push({ email, error: msg });
    }
  }
  return { sent, failed };
}

export async function revokeInvitation({ id }) {
  if (!id) {
    const err = new Error('Which invitation?');
    err.status = 400;
    throw err;
  }
  const client = await clerkClient();
  const inv = await client.invitations.revokeInvitation(id);
  return { id: inv.id, email: inv.emailAddress, status: inv.status };
}

// Clerk has no "resend": revoke the pending one and create a fresh one,
// which sends a new email.
export async function resendInvitation({ id, adminId }) {
  const client = await clerkClient();
  let old;
  try {
    old = await client.invitations.revokeInvitation(id);
  } catch (err) {
    const e = new Error('That invitation can’t be resent (already accepted or revoked).');
    e.status = 400;
    throw e;
  }
  return inviteEmails({ emails: [old.emailAddress], adminId });
}

export async function dismissRequest({ requestId, adminId }) {
  const supabase = getSupabase();
  const { error } = await supabase.from('beta_requests').update({
    status: 'dismissed',
    decided_at: new Date().toISOString(),
    decided_by: adminId || null,
    updated_at: new Date().toISOString()
  }).eq('id', requestId);
  if (error) throw error;
  return { ok: true };
}
