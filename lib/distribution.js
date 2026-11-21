import { randomBytes } from 'node:crypto';
import { getSupabase } from './supabase';
import { getPriceRow } from './purchases';
import { locationsForRelease } from './locationCredits';
import { listPartners } from './partners';
import { ProductionError } from './productions';
import { liveScreeningCount, productionScreenings } from './screenings';

// Distribution (migration 109). See the migration's header. Its
// screeners became private screening links (migration 128,
// lib/screenings.js): the page lists the release's links and the
// production's old screeners, read-only, and links to the title's
// Private screenings tab where they are made.

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
  // A uuid column: a link that isn't one is "not here", not a 500.
  if (!/^[0-9a-f-]{36}$/i.test(String(productionId || ''))) fail('That production isn’t here.', 404);
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

// The release plan's checks for one production row, without the owner's
// gate: the production dashboard (lib/productionDashboard.js) shows how
// many are done to whoever runs it. The same reads getDistribution makes
// for its checklist; a read that fails counts that check as not done.
// screenersLive = the private screening links of the release, and the
// production's old screeners, that work right now (lib/screenings.js).
// → { checklist: { released, buyToOwn, earlyScreening, festivalsSubmitted,
//   trailer, pressKit, shotHere, screenersLive }, screenersLive }
export async function distributionChecklist(row) {
  const supabase = getSupabase();
  const [screenersLive, price, shotAt] = await Promise.all([
    liveScreeningCount(row).catch(() => 0),
    row.release_id ? getPriceRow(row.release_type, row.release_id).catch(() => null) : Promise.resolve(null),
    row.release_id ? locationsForRelease(row.release_type, row.release_id).catch(() => []) : Promise.resolve([])
  ]);
  const now = Date.now();
  let earlyScreening = false;
  if (row.release_id && row.release_type === 'episode') {
    const { data: ep } = await supabase.from('episodes').select('released_at, available_from').eq('id', row.release_id).maybeSingle();
    const t = ep && (ep.released_at || ep.available_from);
    earlyScreening = Boolean(t) && Date.parse(t) > now;
  }
  const festivals = Array.isArray(row.festivals) ? row.festivals : [];
  return {
    checklist: {
      released: Boolean(row.release_id),
      buyToOwn: Boolean(price && price.status === 'on'),
      earlyScreening,
      festivalsSubmitted: festivals.filter((f) => f && ['submitted', 'accepted', 'screened'].includes(f.status)).length,
      trailer: Boolean(row.trailer_url),
      pressKit: Boolean(row.press_kit_url),
      shotHere: (shotAt || []).length,
      screenersLive
    },
    screenersLive
  };
}

// Everything the distribution page shows (owner / admin). `screenings`
// (in place of 109's `screeners`): { links: [Link], href, canManage } —
// the release's private screening links and the production's old
// screeners, read-only here (a link the viewer doesn't run carries no
// password), `href` the title's Private screenings tab, `canManage`
// whether the viewer runs the release (lib/screenings.js). `screeners: []`
// and `episodes: []` stay for installed app builds, which read
// `d.screeners.filter(…)` and `d.episodes.length` (nothing is made here
// any more: its old POST answers 410).
const SITE_ORIGIN = 'https://www.studiotapatv.site';
export async function getDistribution(productionId, { viewerId, isAdmin = false, origin = SITE_ORIGIN }) {
  const row = await ownedProduction(productionId, viewerId, isAdmin);
  const supabase = getSupabase();
  const [screenings, partnersRes, price, shotAt] = await Promise.all([
    productionScreenings(row, { rc: { userId: viewerId, isAdmin }, origin }).catch((err) => {
      console.error('getDistribution screenings:', err && err.message ? err.message : err);
      return { links: [], href: null, canManage: false, live: 0 };
    }),
    listPartners({}, { viewerId }).catch(() => ({ partners: [] })),
    row.release_id ? getPriceRow(row.release_type, row.release_id).catch(() => null) : Promise.resolve(null),
    row.release_id ? locationsForRelease(row.release_type, row.release_id).catch(() => []) : Promise.resolve([])
  ]);
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
    screenings: { links: screenings.links, href: screenings.href, canManage: screenings.canManage },
    screeners: [],
    episodes: [],
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
      screenersLive: screenings.live
    },
    canEdit: true
  };
}

export async function updateDistribution(userId, productionId, patch, { isAdmin = false, origin = SITE_ORIGIN } = {}) {
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
  return getDistribution(productionId, { viewerId: userId, isAdmin, origin });
}

/* ---------- screenings ---------- */

// The 109 screeners grew into private screening links (migration 128,
// lib/screenings.js): they are made on the title's own page now, under
// Private screenings. The Distribution page reads them (above) and its
// old routes answer from there (pages/api/productions/[id]/screeners.js).
