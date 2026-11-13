// The show each episode row hangs on, for the admin's counts and lists: its
// own series_id, or — for an extra filed only through bonus_parent_* — the
// show it was filed with, or the show of the episode it comes after (the
// rule lib/payees.js and the admin show page follow: an extra is run, paid
// and decided with its show). Rows need id, series_id, content_type,
// bonus_parent_type and bonus_parent_id.
//   → Map(rowId → showId | null)
// A failed read of the parent episodes throws; callers that only count
// fall back to series_id alone.
export async function showsOfRows(supabase, rows) {
  const out = new Map();
  const parents = new Set();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    if (r.series_id) out.set(r.id, String(r.series_id));
    else if (r.content_type === 'bonus' && r.bonus_parent_type === 'series' && r.bonus_parent_id) out.set(r.id, String(r.bonus_parent_id));
    else if (r.content_type === 'bonus' && r.bonus_parent_type === 'episode' && r.bonus_parent_id) parents.add(String(r.bonus_parent_id));
    else out.set(r.id, null);
  }
  const parentShow = new Map();
  const ids = [...parents];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('episodes').select('id, series_id').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    for (const p of data || []) parentShow.set(String(p.id), p.series_id ? String(p.series_id) : null);
  }
  for (const r of rows || []) {
    if (r && r.id && !out.has(r.id)) out.set(r.id, parentShow.get(String(r.bonus_parent_id)) || null);
  }
  return out;
}
