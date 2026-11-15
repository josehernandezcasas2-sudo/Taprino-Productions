import { getSupabase } from './supabase';
import { findEpisode } from './episodes';
import { isTitleId } from './titleIds';
import { adFreeContent } from './adBreakRules';

// SERVER-ONLY. Whether an ad played "inside" a title may earn that title
// ad share (migration 103): the title an ad receipt is signed with
// (/api/house-ads/pick, /api/house-ads/vast; lib/adImpressionSig.js).
// Security fixes, 2026-11-15: the two routes signed a receipt for any
// title id they were sent, so a plain loop — no player, nothing playing —
// spent advertisers' credit and credited half of it to a chosen title.
// Now a receipt names a title only when that title is one a viewer could
// be watching with our ads on:
//   - public: what the public reader finds (lib/episodes.js findEpisode —
//     approved, not held, not on its way out, not expired, its show public,
//     an extra's parent public), and not withdrawn (withdrawn_at, its own or
//     its show's, read here as well);
//   - its ads on (the creator's switch), and never a podcast (ad-free since
//     2026-11-13, lib/adBreakRules.js adFreeContent).
// Anything else is signed with no title: the ad still counts for the
// advertiser's report, and earns nobody ad share. A read that fails says
// no. Answers are kept a minute per server instance (a title taken down
// stops earning within that), so a burst of requests doesn't become a
// burst of database reads.

const TTL_MS = 60 * 1000;
const MAX_KEPT = 2000;
const kept = new Map(); // id → { ok, at }

function remember(id, ok) {
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value);
  kept.set(id, { ok, at: Date.now() });
  return ok;
}

async function withdrawn(episode) {
  const supabase = getSupabase();
  const own = await supabase.from('episodes').select('withdrawn_at').eq('id', episode.id).maybeSingle();
  if (own.error) {
    // A database without the column (before migration 097) has nothing withdrawn.
    if (/withdrawn_at/.test(own.error.message || '')) return false;
    throw new Error(own.error.message);
  }
  if (own.data && own.data.withdrawn_at) return true;
  if (!episode.seriesId) return false;
  const show = await supabase.from('series').select('withdrawn_at').eq('id', episode.seriesId).maybeSingle();
  if (show.error) {
    if (/withdrawn_at/.test(show.error.message || '')) return false;
    throw new Error(show.error.message);
  }
  return Boolean(show.data && show.data.withdrawn_at);
}

// true when an ad receipt may carry this title (see above).
export async function earnsAdShare(episodeId) {
  if (!isTitleId(episodeId)) return false;
  const hit = kept.get(episodeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  try {
    const episode = await findEpisode(episodeId);
    if (!episode) return remember(episodeId, false);
    if (episode.adsEnabled === false || episode.contentType === 'podcast' || adFreeContent(episode.contentType)) return remember(episodeId, false);
    if (await withdrawn(episode)) return remember(episodeId, false);
    return remember(episodeId, true);
  } catch (err) {
    console.error('earnsAdShare:', err && err.message);
    return false;
  }
}

// The title to sign an ad receipt with: the id when it earns ad share,
// else null (the receipt names no title).
export async function adShareEpisodeId(episodeId) {
  return (await earnsAdShare(episodeId)) ? episodeId : null;
}
