import { getSupabase } from './supabase';
import { invalidateCache } from './redis';
import { episodeDisplayTitle } from './showRules';
import { isTitleId } from './titleIds';

// A stored episode title is never empty (2026-11-03). An episode sent from
// the show page without a title of its own is stored as "Episode N", the
// words episodeDisplayTitle shows for it, because many readers print
// episodes.title as stored: Stripe's Checkout (which refuses an empty
// product name), the podcast feed, the live guide, the Money page, the
// schedule. A title that is only its number follows the number when the
// episode moves: lib/showPage.js (reorder, move, the editor) and the two
// older edit routes call syncNumberTitles after a change of place. Kept
// apart from lib/showPage.js so those routes stay light.

const NUMBER_TITLE = /^Episode \d+$/;

function posInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function numberTitle(seriesOrder) {
  return episodeDisplayTitle({ title: '', series_order: posInt(seriesOrder) });
}

// Best effort: a title that can't be renamed never fails the move that
// called it (the show page still shows the right number on each row).
export async function syncNumberTitles(ids) {
  try {
    const list = [...new Set((ids || []).filter(Boolean).map(String))].filter((id) => isTitleId(id));
    if (list.length === 0) return 0;
    const supabase = getSupabase();
    const { data, error } = await supabase.from('episodes').select('id, title, series_order').in('id', list);
    if (error) {
      console.error('syncNumberTitles read:', error.message);
      return 0;
    }
    let changed = 0;
    for (const r of data || []) {
      const t = String(r.title || '').trim();
      if (t && !(NUMBER_TITLE.test(t) && posInt(r.series_order))) continue;
      const want = numberTitle(r.series_order);
      if (t === want) continue;
      const { error: writeError } = await supabase.from('episodes').update({ title: want }).eq('id', r.id).eq('title', r.title ?? '');
      if (writeError) console.error('syncNumberTitles write:', writeError.message);
      else changed += 1;
    }
    if (changed > 0) await invalidateCache('public_episodes_v1');
    return changed;
  } catch (err) {
    console.error('syncNumberTitles:', err && err.message);
    return 0;
  }
}
