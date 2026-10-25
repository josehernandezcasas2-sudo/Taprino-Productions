import { getSupabase } from './supabase';

// Credits earned through a production (migration 104): a person is on a
// production's crew with worked = true (the owner or an admin confirmed
// it), and the production is linked to a title that's approved and live
// on Studio Tapa. The owner's own rows don't count toward their tier —
// their upload already does, and nobody confirms their own work.
//
// lib/userProfiles.js (credited work on a profile) and lib/crewCards.js
// (released-title counts behind the tier) read these. Nothing here
// imports anything but Supabase, so either can pull it in.

function isMissing(error) {
  return error && (error.code === 'PGRST205' || error.code === '42P01' || /production/i.test(error.message || ''));
}

// { userId: [ { type: 'episode'|'series', id, title, poster, contentType,
//   mainGenre, createdAt, role, productionId, productionTitle, own } ] }
export async function productionCreditsFor(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {};
  for (const id of ids) out[id] = [];
  if (ids.length === 0) return out;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('production_members')
    .select('user_id, role, production_id, productions!inner(id, title, owner_id, status, moderation_hold, release_type, release_id)')
    .in('user_id', ids)
    .eq('worked', true)
    .eq('hidden', false)
    .not('productions.release_id', 'is', null);
  if (error) {
    if (!isMissing(error)) console.error('productionCreditsFor:', error.message);
    return out;
  }
  const rows = (data || []).filter((r) => r.productions && r.productions.status !== 'removed' && !r.productions.moderation_hold && r.productions.release_id);
  if (rows.length === 0) return out;
  const epIds = [...new Set(rows.filter((r) => r.productions.release_type === 'episode').map((r) => r.productions.release_id))];
  const seriesIds = [...new Set(rows.filter((r) => r.productions.release_type === 'series').map((r) => r.productions.release_id))];
  const [eps, series] = await Promise.all([
    epIds.length ? supabase.from('episodes').select('id, title, poster, thumbnail, content_type, main_genre, created_at').in('id', epIds).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false) : Promise.resolve({ data: [] }),
    seriesIds.length ? supabase.from('series').select('id, name, poster, thumbnail, created_at').in('id', seriesIds).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false) : Promise.resolve({ data: [] })
  ]);
  const titles = new Map();
  for (const e of eps.data || []) titles.set(`episode:${e.id}`, { type: 'episode', id: e.id, title: e.title, poster: e.poster || e.thumbnail || null, contentType: e.content_type, mainGenre: e.main_genre || null, createdAt: e.created_at });
  for (const s of series.data || []) titles.set(`series:${s.id}`, { type: 'series', id: s.id, title: s.name, poster: s.poster || s.thumbnail || null, contentType: 'series', mainGenre: null, createdAt: s.created_at });
  for (const r of rows) {
    const t = titles.get(`${r.productions.release_type}:${r.productions.release_id}`);
    if (!t) continue;
    const list = out[r.user_id];
    // One line per title per person; several roles join up.
    const prev = list.find((x) => x.type === t.type && x.id === t.id);
    if (prev) {
      if (r.role && !prev.role.split(', ').includes(r.role)) prev.role = `${prev.role}, ${r.role}`;
      continue;
    }
    list.push({ ...t, role: r.role, productionId: r.productions.id, productionTitle: r.productions.title, own: r.productions.owner_id === r.user_id });
  }
  return out;
}

// Everyone credited on one released title through productions, for the
// title's page: [{ userId, role, productionId }]. Released titles only
// — the caller already knows the title is live.
export async function releaseCredits(type, id) {
  if (!type || !id) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('production_members')
    .select('user_id, role, production_id, productions!inner(id, title, status, moderation_hold, release_type, release_id)')
    .eq('worked', true)
    .eq('hidden', false)
    .eq('productions.release_type', type)
    .eq('productions.release_id', String(id));
  if (error) {
    if (!isMissing(error)) console.error('releaseCredits:', error.message);
    return [];
  }
  return (data || [])
    .filter((r) => r.productions && r.productions.status !== 'removed' && !r.productions.moderation_hold)
    .map((r) => ({ userId: r.user_id, role: r.role, productionId: r.production_id, productionTitle: r.productions.title }));
}
