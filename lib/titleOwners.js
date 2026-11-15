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
