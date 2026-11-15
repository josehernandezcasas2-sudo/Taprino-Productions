import { getSupabase } from './supabase';
import { isTitleId } from './titleIds';
import { internalError } from './apiErrors';

// SERVER-ONLY. Whose work an episode row is, for "nobody but a full admin
// approves their own work" (2026-11-15): the uploader, and whoever runs
// its show — the show it's filed under, or for an extra filed only
// through bonus_parent_* the show it hangs on (directly, or through its
// parent episode). Shared by the review queue, the Library's status
// change and the staged-change decisions, so none of them asks a
// narrower question than the others. A failed read throws (an approval
// never goes ahead on a guess).
export async function episodeOwnerIds(row) {
  if (!row) return [];
  const owners = [row.submitted_by || null];
  let showId = row.series_id || null;
  if (!showId && row.content_type === 'bonus' && row.bonus_parent_type === 'series') showId = row.bonus_parent_id || null;
  if (!showId && row.content_type === 'bonus' && row.bonus_parent_type === 'episode' && isTitleId(String(row.bonus_parent_id || ''))) {
    const { data: parent, error } = await getSupabase().from('episodes').select('series_id').eq('id', String(row.bonus_parent_id)).maybeSingle();
    if (error) throw internalError(error, 'episodeOwnerIds parent');
    showId = parent ? parent.series_id || null : null;
  }
  if (showId && isTitleId(String(showId))) {
    const { data: show, error } = await getSupabase().from('series').select('creator_id').eq('id', String(showId)).maybeSingle();
    if (error) throw internalError(error, 'episodeOwnerIds show');
    if (show) owners.push(show.creator_id || null);
  }
  return owners.filter(Boolean);
}

// Whose work a show is, for the same rule applied to the show as a whole
// (bringing a removed show back, Restore / "Looks fine" on a reported
// show; 2026-11-15): whoever runs it, and everyone who uploaded something
// filed in it — its episodes, the extras filed under it, and the extras
// filed after one of its episodes — since those come back (or stay up)
// with it. `creatorId` saves a read when the caller has the row. A failed
// read throws (never a narrower answer on a guess).
export async function showOwnerIds(showId, { creatorId } = {}) {
  if (!showId || !isTitleId(String(showId))) return [];
  const supabase = getSupabase();
  const owners = new Set();
  let runner = creatorId;
  if (runner === undefined) {
    const { data: show, error } = await supabase.from('series').select('creator_id').eq('id', String(showId)).maybeSingle();
    if (error) throw internalError(error, 'showOwnerIds show');
    runner = show ? show.creator_id || null : null;
  }
  if (runner) owners.add(runner);
  const filed = await supabase.from('episodes').select('id, submitted_by').eq('series_id', String(showId));
  if (filed.error) throw internalError(filed.error, 'showOwnerIds episodes');
  const extras = await supabase.from('episodes').select('id, submitted_by').eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', String(showId));
  if (extras.error) throw internalError(extras.error, 'showOwnerIds extras');
  const rows = [...(filed.data || []), ...(extras.data || [])];
  const ids = (filed.data || []).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const after = await supabase.from('episodes').select('id, submitted_by').eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', ids.slice(i, i + 100));
    if (after.error) throw internalError(after.error, 'showOwnerIds anchored extras');
    rows.push(...(after.data || []));
  }
  for (const r of rows) if (r && r.submitted_by) owners.add(r.submitted_by);
  return [...owners];
}
