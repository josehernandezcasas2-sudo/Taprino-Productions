import { getSupabase } from './supabase';
import { getPublicProfilesByIds, profilePath } from './userProfiles';
import { notifyCreator } from './notify';
import { checkRateLimit, firstInWindow } from './rateLimit';
import { ownProductionInfo } from './productionLinks';

// "Shot here" (migration 107): released titles ↔ the places they were
// shot at. See the migration's header for the two ways a credit arrives.

export class CreditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new CreditError(message, status); };
const NIL = '00000000-0000-0000-0000-000000000000';

function isMissing(error) {
  return error && (error.code === 'PGRST205' || error.code === '42P01' || /location_credits/.test(error.message || ''));
}

const releaseHref = (type, id) => (type === 'series' ? `/series/${id}` : `/episode/${id}`);

// Live titles for a set of credits, keyed "type:id".
async function titlesFor(rows) {
  const supabase = getSupabase();
  const epIds = [...new Set(rows.filter((r) => r.release_type === 'episode').map((r) => r.release_id))];
  const seriesIds = [...new Set(rows.filter((r) => r.release_type === 'series').map((r) => r.release_id))];
  const [eps, series] = await Promise.all([
    epIds.length ? supabase.from('episodes').select('id, title, poster, thumbnail, content_type, created_at').in('id', epIds).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false) : Promise.resolve({ data: [] }),
    seriesIds.length ? supabase.from('series').select('id, name, poster, thumbnail, created_at').in('id', seriesIds).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false) : Promise.resolve({ data: [] })
  ]);
  const map = new Map();
  for (const e of eps.data || []) map.set(`episode:${e.id}`, { type: 'episode', id: e.id, title: e.title, poster: e.poster || e.thumbnail || null, contentType: e.content_type, year: e.created_at ? new Date(e.created_at).getFullYear() : null });
  for (const s of series.data || []) map.set(`series:${s.id}`, { type: 'series', id: s.id, title: s.name, poster: s.poster || s.thumbnail || null, contentType: 'series', year: s.created_at ? new Date(s.created_at).getFullYear() : null });
  return map;
}

function toCredit(row, title, people) {
  const t = title || { type: row.release_type, id: row.release_id, title: row.release_title || 'A title', poster: null, contentType: null, year: null };
  return {
    id: row.id,
    locationId: row.location_id,
    type: t.type,
    releaseId: t.id,
    title: t.title,
    poster: t.poster,
    contentType: t.contentType,
    year: t.year,
    href: releaseHref(t.type, t.id),
    live: Boolean(title),
    // Which booking or production a credit came from stays on the server
    // (safety batch, 2026-10-26): a credit is public, a booking isn't,
    // and a production may be private. viaBooking says enough.
    status: row.status,
    note: row.note || '',
    claimedBy: people && people[row.claimed_by] ? { userId: row.claimed_by, displayName: people[row.claimed_by].displayName, profilePath: profilePath(people[row.claimed_by]) } : { userId: row.claimed_by },
    viaBooking: Boolean(row.request_id),
    createdAt: row.created_at
  };
}

// Approved credits on one place (everyone), plus pending ones for the
// host / admin / the claimant.
export async function creditsForLocation(locationId, { viewerId = null, isHost = false, isAdmin = false } = {}) {
  const { data, error } = await getSupabase().from('location_credits').select('*').eq('location_id', locationId).order('created_at', { ascending: false });
  if (error) {
    if (isMissing(error)) return [];
    throw new Error(error.message);
  }
  const rows = (data || []).filter((r) => r.status === 'approved' || ((isHost || isAdmin || r.claimed_by === viewerId) && r.status !== 'declined'));
  if (rows.length === 0) return [];
  const [titles, people] = await Promise.all([titlesFor(rows), getPublicProfilesByIds(rows.map((r) => r.claimed_by))]);
  return rows.map((r) => toCredit(r, titles.get(`${r.release_type}:${r.release_id}`) || null, people)).filter((c) => c.live || c.status !== 'approved');
}

// Approved credit counts for many places (listing cards).
export async function creditCountsFor(locationIds) {
  const out = {};
  const ids = [...new Set((locationIds || []).filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await getSupabase().from('location_credits').select('location_id').in('location_id', ids).eq('status', 'approved');
  if (error) return out;
  for (const r of data || []) out[r.location_id] = (out[r.location_id] || 0) + 1;
  return out;
}

// Where a released title was shot (the title's page): [{ locationId, title, city, href }].
export async function locationsForRelease(type, id) {
  if (!type || !id) return [];
  const { data, error } = await getSupabase().from('location_credits').select('location_id, locations!inner(id, title, city, status, moderation_hold)').eq('release_type', type).eq('release_id', String(id)).eq('status', 'approved');
  if (error) {
    if (!isMissing(error)) console.error('locationsForRelease:', error.message);
    return [];
  }
  return (data || []).filter((r) => r.locations && r.locations.status !== 'removed' && !r.locations.moderation_hold).map((r) => ({ locationId: r.locations.id, title: r.locations.title, city: r.locations.city || '', href: `/locations/${r.locations.id}` }));
}

// Pending claims on a host's places (Your places).
export async function pendingClaimsForHost(hostId) {
  if (!hostId) return [];
  const { data, error } = await getSupabase().from('location_credits').select('*, locations!inner(title)').eq('host_id', hostId).eq('status', 'pending').order('created_at', { ascending: true });
  if (error) {
    if (isMissing(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  if (rows.length === 0) return [];
  const [titles, people] = await Promise.all([titlesFor(rows), getPublicProfilesByIds(rows.map((r) => r.claimed_by))]);
  return rows.map((r) => ({ ...toCredit(r, titles.get(`${r.release_type}:${r.release_id}`) || null, people), locationTitle: r.locations.title }));
}

// A release the claimant can speak for: their own live title, or one a
// production they own released as.
async function ownRelease(userId, release) {
  if (!release || typeof release !== 'object') fail('Pick the title.');
  const type = release.type === 'episode' || release.type === 'series' ? release.type : null;
  const id = release.id == null ? '' : String(release.id).trim().slice(0, 80);
  if (!type || !id) fail('Pick the title.');
  const supabase = getSupabase();
  let title = null;
  let owner = null;
  if (type === 'episode') {
    const { data: e } = await supabase.from('episodes').select('id, title, submitted_by, status, deletion_requested, moderation_hold').eq('id', id).maybeSingle();
    if (!e || e.status !== 'approved' || e.deletion_requested || e.moderation_hold) fail('Only a title that’s live on Studio Tapa can be credited.');
    title = e.title; owner = e.submitted_by;
  } else {
    const { data: s } = await supabase.from('series').select('id, name, creator_id, status, deletion_requested, moderation_hold').eq('id', id).maybeSingle();
    if (!s || (s.status && s.status !== 'approved') || s.deletion_requested || s.moderation_hold) fail('Only a series that’s live on Studio Tapa can be credited.');
    title = s.name; owner = s.creator_id;
  }
  if (owner !== userId) {
    const { data: prod } = await supabase.from('productions').select('id').eq('owner_id', userId).eq('release_type', type).eq('release_id', id).limit(1);
    if (!prod || prod.length === 0) fail('You can credit a place on your own titles (or on a production you own that released as this title).', 403);
  }
  return { type, id, title };
}

// A maker says "we shot <title> here": pending until the host approves.
export async function claimCredit(userId, locationId, { release, note, productionId }) {
  if (!userId) fail('Sign in first.', 401);
  const supabase = getSupabase();
  const { data: loc, error } = await supabase.from('locations').select('id, host_id, title, status, moderation_hold').eq('id', locationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!loc || loc.status === 'removed' || loc.moderation_hold) fail('That place isn’t here.', 404);
  const rel = await ownRelease(userId, release);
  if (!(await checkRateLimit(`location-credit:${userId}`, 20, 86400))) fail('That’s a lot of credits for one day.', 429);
  const isHost = loc.host_id === userId;
  // A credit can name one of the claimant's own productions, never a
  // stranger's (security round, 2026-10-26).
  const production = productionId ? await ownProductionInfo(productionId, userId, fail) : null;
  const row = {
    location_id: locationId, host_id: loc.host_id, claimed_by: userId,
    release_type: rel.type, release_id: rel.id, release_title: rel.title,
    production_id: production ? production.id : null,
    note: String(note || '').trim().slice(0, 300) || null,
    status: isHost ? 'approved' : 'pending', decided_at: isHost ? new Date().toISOString() : null
  };
  const ins = await supabase.from('location_credits').insert(row).select('*').single();
  if (ins.error) {
    if (ins.error.code === '23505') fail('That title is already credited here (or waiting on the host).', 409);
    if (isMissing(ins.error)) fail('Shot-here credits aren’t set up yet — the admin needs to run migration 107.', 503);
    throw new Error(ins.error.message);
  }
  if (!isHost) {
    const people = await getPublicProfilesByIds([userId]);
    await notifyCreator({ userId: loc.host_id, type: 'location_credit', message: `${people[userId].displayName} says ${rel.title} was shot at ${loc.title}. Approve it and the title shows under “Shot here”.`, href: `/locations/${locationId}?tab=shot` });
  }
  return { id: ins.data.id, status: ins.data.status };
}

// Host (or admin): approve / decline a claim.
export async function decideCredit(userId, creditId, decision, { isAdmin = false } = {}) {
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('location_credits').select('*, locations!inner(title)').eq('id', creditId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) fail('That credit isn’t here.', 404);
  if (row.host_id !== userId && !isAdmin) fail('Only the host decides.', 403);
  const status = decision === 'approve' ? 'approved' : decision === 'decline' ? 'declined' : null;
  if (!status) fail('decision must be approve or decline.');
  if (row.status === status) return { id: creditId, status };
  const { error: upErr } = await supabase.from('location_credits').update({ status, decided_at: new Date().toISOString() }).eq('id', creditId);
  if (upErr) throw new Error(upErr.message);
  // The claimant hears about a real change, and at most once per ten
  // minutes per credit (a host flipping approve/decline in a loop was a
  // way to ring someone's bell; security round 2, 2026-10-28).
  if (row.claimed_by !== userId && await firstInWindow(`credit-decision:${creditId}`, 600)) {
    await notifyCreator({ userId: row.claimed_by, type: 'location_credit', message: status === 'approved' ? `${row.locations.title} now lists ${row.release_title || 'your title'} under “Shot here”, and the title links back to the place.` : `The host didn’t confirm ${row.release_title || 'your title'} was shot at ${row.locations.title}.`, href: `/locations/${row.location_id}?tab=shot` });
  }
  return { id: creditId, status };
}

// The host takes a credit off their place.
export async function removeCredit(userId, creditId, { isAdmin = false } = {}) {
  const supabase = getSupabase();
  const { data: row } = await supabase.from('location_credits').select('id, host_id, claimed_by').eq('id', creditId).maybeSingle();
  if (!row) fail('That credit isn’t here.', 404);
  if (row.host_id !== userId && row.claimed_by !== userId && !isAdmin) fail('Not yours.', 403);
  const { error } = await supabase.from('location_credits').delete().eq('id', creditId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// A paid booking that went as agreed, for a production that has (or
// later gets) a release, is a credit the host has already confirmed.
// Called when the host settles the booking and when a release is linked.
export async function autoCreditFromBooking(requestRow) {
  if (!requestRow || !requestRow.production_id || requestRow.outcome !== 'as_agreed') return null;
  const supabase = getSupabase();
  try {
    const { data: prod } = await supabase.from('productions').select('id, owner_id, release_type, release_id, release_title').eq('id', requestRow.production_id).maybeSingle();
    if (!prod || !prod.release_id) return null;
    const row = {
      location_id: requestRow.location_id, host_id: requestRow.host_id, claimed_by: requestRow.producer_id,
      release_type: prod.release_type, release_id: prod.release_id, release_title: prod.release_title,
      production_id: prod.id, request_id: requestRow.id, status: 'approved', decided_at: new Date().toISOString()
    };
    const { error } = await supabase.from('location_credits').upsert(row, { onConflict: 'location_id,release_type,release_id', ignoreDuplicates: true });
    if (error && !isMissing(error)) console.error('autoCreditFromBooking:', error.message);
    return row;
  } catch (err) {
    console.error('autoCreditFromBooking:', err.message);
    return null;
  }
}

// When a production's release is linked: every as-agreed booking for it
// becomes a credit on its place.
export async function autoCreditsForProduction(productionId) {
  const { data } = await getSupabase().from('location_requests').select('*').eq('production_id', productionId).eq('outcome', 'as_agreed');
  for (const r of data || []) await autoCreditFromBooking(r);
}

export const NIL_ID = NIL;
