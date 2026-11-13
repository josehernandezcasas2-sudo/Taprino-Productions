import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { getSupabase } from '../../../lib/supabase';
import { listReviewQueue } from '../../../lib/reviewQueue';
import { getModerationState } from '../../../lib/moderation';
import { reviewQueueKeys } from '../../../lib/moderationRules';
import { applyCors } from '../../../lib/cors';
import { showsOfRows } from '../../../lib/rowShows';

// Badge numbers for the admin nav (components/AdminShell.js) and the
// mobile admin home. Cheap-ish; everything fails soft to 0.
//
//   review    the merged review queue (lib/reviewQueue.js)
//   channel   channel uploads waiting
//   library   what Library & queues lists, each part for whoever can act
//             on it: staged artwork (posters, stills, a show's hero image,
//             title image or its removal, trailer) for manage_artwork, a
//             new video file waiting on a title in no show for
//             manage_artwork + review_submissions,
//             staged titles / names / descriptions / page notes for
//             manage_episodes,
//             removal requests not already withdrawn (a title kept for its
//             buyers is done) for manage_deletions
//   shows     Admin → Shows (the series revamp, slice 3a): across shows,
//             episodes in review + staged changes (on its episodes and its
//             extras, those filed only through bonus_parent_* too; art — an episode's
//             title image, its removal and trailer since migration 120 —,
//             text, a new video waiting, a show's season art since
//             migration 122) + removal requests, for manage_episodes or
//             review_submissions.
//   flags     what /admin/content's review queue lists (lib/moderationRules.js
//             reviewQueueKeys): each item with an open flag or counted
//             reports not ignored, once — tip notes (Admin → Tips) and items
//             deleted since they were reported left out
//   pitch     reported Pitch Room comments (full admins)
//
// The staged and removal numbers come from two reads (one of episodes,
// one of shows) that fetch only the rows that need someone and count them
// here, rather than one count query per kind. `pending_src` (a staged
// replacement video) is migration 118's, an episode's waiting title
// image (or its removal) and trailer are 120's and its waiting page notes
// 122's ('' = clearing them waits, so it counts): the read tries with all
// of them, then without 122's, then without 120's, then without either.
const EPISODE_FLAGS = 'id, series_id, content_type, bonus_parent_type, bonus_parent_id, status, pending_poster, pending_thumbnail, pending_title, pending_description, deletion_requested, withdrawn_at';
const EPISODE_WANTED = [
  'pending_poster.not.is.null',
  'pending_thumbnail.not.is.null',
  'pending_title.not.is.null',
  'pending_description.not.is.null',
  'and(deletion_requested.eq.true,withdrawn_at.is.null)',
  'and(status.eq.pending,series_id.not.is.null)'
];
const SERIES_FLAGS = 'id, pending_poster, pending_thumbnail, pending_trailer_src, pending_hero_image, pending_title_image_url, pending_title_image_removal, pending_name, pending_description, deletion_requested, withdrawn_at';
const SERIES_WANTED = [
  'pending_poster.not.is.null',
  'pending_thumbnail.not.is.null',
  'pending_trailer_src.not.is.null',
  'pending_hero_image.not.is.null',
  'pending_title_image_url.not.is.null',
  'pending_title_image_removal.eq.true',
  'pending_name.not.is.null',
  'pending_description.not.is.null',
  'and(deletion_requested.eq.true,withdrawn_at.is.null)'
];

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

const has = (v) => v !== null && v !== undefined && v !== '';

const EPISODE_120_FLAGS = 'pending_title_image_url, pending_title_image_removal, pending_trailer_src';
const EPISODE_120_WANTED = ['pending_title_image_url.not.is.null', 'pending_title_image_removal.eq.true', 'pending_trailer_src.not.is.null'];

async function episodesNeedingSomeone(supabase) {
  let res = await supabase.from('episodes').select(`${EPISODE_FLAGS}, pending_src, ${EPISODE_120_FLAGS}, pending_page_notes`).or([...EPISODE_WANTED, 'pending_src.not.is.null', ...EPISODE_120_WANTED, 'pending_page_notes.not.is.null'].join(','));
  if (res.error && isMissingColumn(res.error)) res = await supabase.from('episodes').select(`${EPISODE_FLAGS}, pending_src, ${EPISODE_120_FLAGS}`).or([...EPISODE_WANTED, 'pending_src.not.is.null', ...EPISODE_120_WANTED].join(','));
  if (res.error && isMissingColumn(res.error)) res = await supabase.from('episodes').select(`${EPISODE_FLAGS}, pending_src`).or([...EPISODE_WANTED, 'pending_src.not.is.null'].join(','));
  if (res.error && isMissingColumn(res.error)) res = await supabase.from('episodes').select(EPISODE_FLAGS).or(EPISODE_WANTED.join(','));
  if (res.error) {
    console.error('queue-counts episodes:', res.error.message);
    return [];
  }
  return res.data || [];
}

// A show's season art waiting for approval (migration 122's
// pending_season_art, decided on its admin show page) counts toward Shows;
// the Library's queues don't list it, so it is never in `artwork`. Read
// without the column before 122.
async function seriesNeedingSomeone(supabase) {
  let res = await supabase.from('series').select(`${SERIES_FLAGS}, pending_season_art`).or([...SERIES_WANTED, 'pending_season_art.not.is.null'].join(','));
  if (res.error && isMissingColumn(res.error)) res = await supabase.from('series').select(SERIES_FLAGS).or(SERIES_WANTED.join(','));
  if (res.error) {
    console.error('queue-counts series:', res.error.message);
    return [];
  }
  return res.data || [];
}

// Each row is counted by what it actually holds (the filter only narrows
// the read), once per queue it is in. `showOf` (lib/rowShows.js): the show
// a row hangs on, an extra filed only through bonus_parent_* included —
// its staged changes are decided on that show's admin page. A new video
// file waiting on a title in no show is the Library's (`videos`).
function stagedCounts(episodes, series, showOf = new Map()) {
  const removal = (r) => r.deletion_requested === true && !has(r.withdrawn_at);
  const epArt = (r) => has(r.pending_poster) || has(r.pending_thumbnail) || has(r.pending_title_image_url) || r.pending_title_image_removal === true || has(r.pending_trailer_src);
  const epText = (r) => has(r.pending_title) || has(r.pending_description) || typeof r.pending_page_notes === 'string';
  const epVideo = (r) => has(r.pending_src);
  const seArt = (r) => has(r.pending_poster) || has(r.pending_thumbnail) || has(r.pending_trailer_src) || has(r.pending_hero_image) || has(r.pending_title_image_url) || r.pending_title_image_removal === true;
  const seText = (r) => has(r.pending_name) || has(r.pending_description);
  // Season art waiting (migration 122): a non-empty list.
  const seSeasons = (r) => Array.isArray(r.pending_season_art) && r.pending_season_art.length > 0;
  const inShow = (r) => has(r.series_id);
  const withShow = (r) => inShow(r) || has(showOf.get(r.id));
  const count = (rows, test) => rows.filter(test).length;
  return {
    artwork: count(episodes, epArt) + count(series, seArt),
    edits: count(episodes, epText) + count(series, seText),
    deletions: count(episodes, removal) + count(series, removal),
    videos: count(episodes, (r) => !withShow(r) && epVideo(r)),
    shows: count(episodes, (r) => inShow(r) && r.status === 'pending')
      + count(episodes, (r) => withShow(r) && (epArt(r) || epText(r) || epVideo(r)))
      + count(series, (r) => seArt(r) || seText(r) || seSeasons(r))
      + count(episodes, (r) => inShow(r) && removal(r))
      + count(series, removal)
  };
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');

  const rc = await getRoleContext(req);
  if (!rc.canAccessAdmin) return res.status(403).json({ error: 'Admin access required.' });

  const supabase = getSupabase();
  const can = {
    artwork: rc.isAdmin || hasCapability(rc, 'manage_artwork'),
    edits: rc.isAdmin || hasCapability(rc, 'manage_episodes'),
    deletions: rc.isAdmin || hasCapability(rc, 'manage_deletions'),
    shows: rc.isAdmin || hasCapability(rc, 'manage_episodes') || hasCapability(rc, 'review_submissions'),
    // A title's new video file in the Library (its artwork list): read by
    // manage_artwork, decided by review_submissions.
    videos: rc.isAdmin || (hasCapability(rc, 'manage_artwork') && hasCapability(rc, 'review_submissions')),
    flags: rc.isAdmin || hasCapability(rc, 'handle_flags')
  };
  const wantsStaged = can.artwork || can.edits || can.deletions || can.shows;

  const [queue, stagedEpisodes, stagedSeries, moderation, comments] = await Promise.all([
    listReviewQueue(rc, { light: true }).catch(() => ({ counts: { total: 0, channel: 0 } })),
    wantsStaged ? episodesNeedingSomeone(supabase).catch(() => []) : [],
    wantsStaged ? seriesNeedingSomeone(supabase).catch(() => []) : [],
    can.flags ? getModerationState().catch(() => null) : null,
    rc.isAdmin ? supabase.from('pitch_comments').select('id', { count: 'exact', head: true }).eq('reported', true) : null
  ]);

  const n = (r) => (r && !r.error && typeof r.count === 'number' ? r.count : 0);
  // The items the review queue lists: one each, however many flags and
  // reports it has (ignored reports don't need attention).
  const openFlags = moderation ? reviewQueueKeys(moderation).length : 0;
  // Extras filed only through bonus_parent_*: which show (fails soft to
  // series_id alone).
  const extras = stagedEpisodes.filter((r) => !has(r.series_id) && r.content_type === 'bonus');
  const showOf = extras.length ? await showsOfRows(supabase, extras).catch(() => new Map()) : new Map();
  const staged = stagedCounts(stagedEpisodes, stagedSeries, showOf);

  return res.status(200).json({
    review: queue.counts.total,
    channel: queue.counts.channel,
    library: (can.artwork ? staged.artwork : 0) + (can.edits ? staged.edits : 0) + (can.deletions ? staged.deletions : 0) + (can.videos ? staged.videos : 0),
    shows: can.shows ? staged.shows : 0,
    flags: openFlags,
    pitch: n(comments)
  });
}
