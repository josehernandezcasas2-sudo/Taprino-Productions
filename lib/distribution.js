import { randomBytes, createHash } from 'node:crypto';
import { getSupabase } from './supabase';
import { getPublicProfilesByIds } from './userProfiles';
import { notifyCreator } from './notify';
import { checkRateLimit } from './rateLimit';
import { signedSrcForStoredUrl } from './videoSigning';
import { getPriceRow } from './purchases';
import { locationsForRelease } from './locationCredits';
import { listPartners } from './partners';
import { ProductionError } from './productions';

// Distribution + screeners (migration 109). See the migration's header.

const fail = (message, status = 400) => { throw new ProductionError(message, status); };
const str = (v, max) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max));
const text = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const cleanUrl = (v) => {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return null;
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch (err) { return null; }
};

import { FESTIVAL_STATUS, MAX_FESTIVALS, SCREENER_DAYS, SCREENER_SRC_SECONDS } from './distributionRules';
export { FESTIVAL_STATUS, MAX_FESTIVALS, SCREENER_DAYS, SCREENER_SRC_SECONDS };

function isMissing(error) {
  return error && (error.code === 'PGRST205' || error.code === '42P01' || /screener|festivals|press_kit|premiere_on|distribution_notes|trailer_url/.test(error.message || ''));
}

/* ---------- the production + its owner ---------- */

async function ownedProduction(productionId, userId, isAdmin) {
  const { data, error } = await getSupabase().from('productions').select('*').eq('id', productionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status === 'removed') fail('That production isn’t here.', 404);
  if (data.owner_id !== userId && !isAdmin) fail('Only the owner sees the distribution page.', 403);
  return data;
}

function toFestival(f) {
  return {
    id: f.id, name: f.name, url: f.url || null, deadline: f.deadline || null, feeCents: f.feeCents == null ? null : f.feeCents,
    status: FESTIVAL_STATUS[f.status] ? f.status : 'planning', statusLabel: FESTIVAL_STATUS[f.status] || 'Planning', notes: f.notes || '', decidedOn: f.decidedOn || null
  };
}

function toScreener(row) {
  const expired = Date.parse(row.expires_at) < Date.now();
  const used = row.views >= row.max_views;
  return {
    id: row.id,
    episodeId: row.episode_id,
    token: row.token,
    path: `/screener/${row.token}`,
    label: row.label,
    recipientEmail: row.recipient_email || '',
    expiresAt: row.expires_at,
    maxViews: row.max_views,
    views: row.views || 0,
    lastViewedAt: row.last_viewed_at || null,
    revokedAt: row.revoked_at || null,
    state: row.revoked_at ? 'revoked' : expired ? 'expired' : used ? 'used up' : 'live',
    createdAt: row.created_at
  };
}

// The owner's own episodes (approved, or still in review) — what a
// screener can play.
async function ownEpisodes(ownerId) {
  const { data } = await getSupabase().from('episodes').select('id, title, status, content_type, poster, thumbnail, src, moderation_hold, deletion_requested, created_at').eq('submitted_by', ownerId).eq('moderation_hold', false).eq('deletion_requested', false).in('status', ['approved', 'pending']).order('created_at', { ascending: false }).limit(100);
  return (data || []).filter((e) => e.src).map((e) => ({ id: e.id, title: e.title, status: e.status, contentType: e.content_type, poster: e.poster || e.thumbnail || null }));
}

// Everything the distribution page shows (owner / admin).
export async function getDistribution(productionId, { viewerId, isAdmin = false }) {
  const row = await ownedProduction(productionId, viewerId, isAdmin);
  const supabase = getSupabase();
  const [screenersRes, episodes, partnersRes, price, shotAt] = await Promise.all([
    supabase.from('screeners').select('*').eq('production_id', productionId).order('created_at', { ascending: false }),
    ownEpisodes(row.owner_id),
    listPartners({}, { viewerId }).catch(() => ({ partners: [] })),
    row.release_id ? getPriceRow(row.release_type, row.release_id).catch(() => null) : Promise.resolve(null),
    row.release_id ? locationsForRelease(row.release_type, row.release_id).catch(() => []) : Promise.resolve([])
  ]);
  const screeners = screenersRes.error ? [] : (screenersRes.data || []).map(toScreener);
  const festivals = Array.isArray(row.festivals) ? row.festivals.map(toFestival) : [];
  const release = row.release_id ? { type: row.release_type, id: row.release_id, title: row.release_title || row.title, href: row.release_type === 'series' ? `/series/${row.release_id}` : `/episode/${row.release_id}` } : null;
  // Early screening (lib/earlyAccess.js): a released episode whose first
  // day is still ahead — Premium members see it first.
  let earlyScreening = null;
  if (release && release.type === 'episode') {
    const { data: ep } = await supabase.from('episodes').select('released_at, available_from').eq('id', release.id).maybeSingle();
    const t = ep && (ep.released_at || ep.available_from);
    earlyScreening = t ? { at: t, ahead: Date.parse(t) > Date.now() } : null;
  }
  return {
    production: { id: row.id, title: row.title, status: row.status, ownerId: row.owner_id },
    release,
    festivals,
    notes: row.distribution_notes || '',
    pressKitUrl: row.press_kit_url || null,
    trailerUrl: row.trailer_url || null,
    premiereOn: row.premiere_on || null,
    premiereNote: row.premiere_note || '',
    screeners,
    episodes,
    partners: (partnersRes.partners || []).filter((p) => p.kind === 'festival' || p.kind === 'distribution').slice(0, 8),
    checklist: {
      released: Boolean(release),
      buyToOwn: Boolean(price && price.status === 'on'),
      earlyScreening: Boolean(earlyScreening && earlyScreening.ahead),
      earlyAt: earlyScreening ? earlyScreening.at : null,
      shotHere: shotAt.length,
      trailer: Boolean(row.trailer_url),
      pressKit: Boolean(row.press_kit_url),
      festivalsSubmitted: festivals.filter((f) => ['submitted', 'accepted', 'screened'].includes(f.status)).length,
      festivalsIn: festivals.filter((f) => ['accepted', 'screened'].includes(f.status)).length,
      screenersLive: screeners.filter((s) => s.state === 'live').length
    },
    canEdit: true
  };
}

export async function updateDistribution(userId, productionId, patch, { isAdmin = false } = {}) {
  const row = await ownedProduction(productionId, userId, isAdmin);
  const src = patch && typeof patch === 'object' ? patch : {};
  const update = { updated_at: new Date().toISOString() };
  if (Array.isArray(src.festivals)) {
    if (src.festivals.length > MAX_FESTIVALS) fail(`Up to ${MAX_FESTIVALS} festivals on the tracker.`);
    update.festivals = src.festivals.map((f, i) => {
      const name = str(f && f.name, 100);
      if (!name) fail(`Festival #${i + 1} needs a name.`);
      const deadline = f.deadline ? String(f.deadline).slice(0, 10) : null;
      if (deadline && !isDate(deadline)) fail(`${name}: the deadline needs a date.`);
      const decidedOn = f.decidedOn ? String(f.decidedOn).slice(0, 10) : null;
      const fee = f.feeCents === '' || f.feeCents == null ? null : Math.max(0, Math.min(500000, Math.round(Number(f.feeCents) || 0)));
      const url = cleanUrl(f.url);
      return { id: /^[0-9a-f-]{6,36}$/i.test(String(f.id || '')) ? String(f.id) : randomBytes(6).toString('hex'), name, url, deadline, feeCents: fee, status: FESTIVAL_STATUS[f.status] ? f.status : 'planning', notes: text(f.notes, 400) || '', decidedOn: decidedOn && isDate(decidedOn) ? decidedOn : null };
    });
  }
  if ('notes' in src) update.distribution_notes = text(src.notes, 4000) || null;
  if ('pressKitUrl' in src) { const u = cleanUrl(src.pressKitUrl); if (src.pressKitUrl && !u) fail('The press kit link doesn’t look like a web address.'); update.press_kit_url = u; }
  if ('trailerUrl' in src) { const u = cleanUrl(src.trailerUrl); if (src.trailerUrl && !u) fail('The trailer link doesn’t look like a web address.'); update.trailer_url = u; }
  if ('premiereOn' in src) { const d = src.premiereOn ? String(src.premiereOn).slice(0, 10) : null; if (d && !isDate(d)) fail('The premiere needs a date.'); update.premiere_on = d; }
  if ('premiereNote' in src) update.premiere_note = str(src.premiereNote, 200) || null;
  const { error } = await getSupabase().from('productions').update(update).eq('id', row.id);
  if (error) {
    if (isMissing(error)) fail('Distribution isn’t set up yet — the admin needs to run migration 109.', 503);
    throw new Error(error.message);
  }
  return getDistribution(productionId, { viewerId: userId, isAdmin });
}

/* ---------- screeners ---------- */

export async function createScreener(userId, productionId, { episodeId, label, recipientEmail, days, maxViews }, { isAdmin = false } = {}) {
  const row = await ownedProduction(productionId, userId, isAdmin);
  const supabase = getSupabase();
  const { data: ep } = await supabase.from('episodes').select('id, title, submitted_by, src, moderation_hold, deletion_requested, status').eq('id', String(episodeId || '')).maybeSingle();
  if (!ep || ep.moderation_hold || ep.deletion_requested || !['approved', 'pending'].includes(ep.status)) fail('Pick one of your own titles.');
  if (ep.submitted_by !== row.owner_id && !isAdmin) fail('A screener plays a title you uploaded.', 403);
  if (!ep.src) fail('That title has no video attached yet.');
  const cleanLabel = str(label, 80);
  if (cleanLabel.length < 2) fail('Say who the screener is for.');
  const email = str(recipientEmail, 120).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('That email doesn’t look right.');
  const d = SCREENER_DAYS.includes(Number(days)) ? Number(days) : 14;
  const cap = Math.max(1, Math.min(500, Math.round(Number(maxViews) || 10)));
  if (!(await checkRateLimit(`screener-create:${userId}`, 40, 86400))) fail('That’s a lot of screeners for one day.', 429);
  const token = randomBytes(18).toString('base64url');
  const { data, error } = await supabase.from('screeners').insert({ production_id: row.id, episode_id: ep.id, token, label: cleanLabel, recipient_email: email, expires_at: new Date(Date.now() + d * 86400000).toISOString(), max_views: cap, created_by: userId }).select('*').single();
  if (error) {
    if (isMissing(error)) fail('Screeners aren’t set up yet — the admin needs to run migration 109.', 503);
    throw new Error(error.message);
  }
  return toScreener(data);
}

export async function revokeScreener(userId, productionId, screenerId, { isAdmin = false } = {}) {
  await ownedProduction(productionId, userId, isAdmin);
  const { error } = await getSupabase().from('screeners').update({ revoked_at: new Date().toISOString() }).eq('id', String(screenerId)).eq('production_id', productionId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// Opening a screener (public, by token). Counts a view, logs it, tells
// the owner, and hands back a signed src good for a few hours.
export async function openScreener(token, { ip = '', userAgent = '', countView = true } = {}) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(t)) fail('That screener link isn’t right.', 404);
  const supabase = getSupabase();
  const { data: s, error } = await supabase.from('screeners').select('*, productions!inner(id, title, owner_id, status)').eq('token', t).maybeSingle();
  if (error) {
    if (isMissing(error)) fail('Screeners aren’t set up on this site yet.', 503);
    throw new Error(error.message);
  }
  if (!s || s.productions.status === 'removed') fail('That screener link isn’t right.', 404);
  if (s.revoked_at) fail('This screener was taken down by the filmmaker.', 410);
  if (Date.parse(s.expires_at) < Date.now()) fail('This screener has expired. Ask the filmmaker for a fresh link.', 410);
  if (countView && s.views >= s.max_views) fail('This screener has been opened as many times as it allows. Ask the filmmaker for a fresh link.', 410);
  const { data: ep } = await supabase.from('episodes').select('id, title, src, poster, thumbnail, moderation_hold, content_type, description').eq('id', s.episode_id).maybeSingle();
  if (!ep || ep.moderation_hold || !ep.src) fail('The video behind this screener isn’t available right now.', 404);
  if (countView) {
    const ipHash = ip ? createHash('sha256').update(`${process.env.CLERK_SECRET_KEY || 'tapa'}:${ip}`).digest('hex').slice(0, 24) : null;
    await supabase.from('screeners').update({ views: (s.views || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', s.id);
    await supabase.from('screener_views').insert({ screener_id: s.id, ip_hash: ipHash, user_agent: String(userAgent || '').slice(0, 200) || null });
    await notifyCreator({ userId: s.productions.owner_id, type: 'screener_opened', message: `Your screener “${s.label}” for ${s.productions.title} was just opened (${(s.views || 0) + 1} of ${s.max_views}).`, href: `/productions/${s.productions.id}/distribution` });
  }
  const signed = await signedSrcForStoredUrl(ep.src, { expiresInSeconds: SCREENER_SRC_SECONDS });
  const owners = await getPublicProfilesByIds([s.productions.owner_id]);
  return {
    production: { id: s.productions.id, title: s.productions.title, ownerName: owners[s.productions.owner_id].displayName },
    screener: { label: s.label, recipientEmail: s.recipient_email || null, expiresAt: s.expires_at, viewsLeft: Math.max(0, s.max_views - (s.views || 0) - (countView ? 1 : 0)), token: t.slice(-6).toUpperCase() },
    episode: { id: ep.id, title: ep.title, poster: ep.poster || ep.thumbnail || null, thumbnail: ep.thumbnail || ep.poster || null, desc: ep.description || '', contentType: ep.content_type },
    src: signed ? signed.src : ep.src,
    signed: Boolean(signed),
    expiresAt: signed ? signed.expiresAt : null
  };
}
