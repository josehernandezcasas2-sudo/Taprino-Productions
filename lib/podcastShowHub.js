import { getAccountContext } from './accountContext';
import { findSeries } from './series';
import { getPodcastShowEpisodes } from './podcastShow';
import { getPublicEpisodes } from './publicEpisodes';
import { getViewerAgeContext } from './viewerAge';
import { getPublicProfilesByIds } from './userProfiles';
import { previewBarWords, showState } from './showRules';
import { teamShowHref } from './seriesHub';

// Shared by pages/podcasts/[id].js and the mobile app's GET
// /api/podcast-show — same show lookup, same per-viewer entitled episode
// list (getPodcastShowEpisodes already strips src/audioUrl for anything
// the caller isn't entitled to). Returns null for a show that doesn't
// exist, or one with no approved episodes at all, which both callers
// turn into their own "not found" response.
//
// opts.preview (slice 4; the page's ?preview=1, website only): a show that
// isn't public comes back for its owner, anyone with an episode in it and
// the team (lib/series.js findSeries), with its episodes in review, every
// one playable and none with ads, and `preview` = { role, state, strong,
// text, linkHref, linkLabel } for the bar. A public show with ?preview=1
// is the ordinary page.
export async function getPodcastShowHubData(showId, req, { preview = false } = {}) {
  let show = await findSeries(showId);
  const account = await getAccountContext(req);
  if (!show && preview && account.isSignedIn) {
    show = await findSeries(showId, { preview: { userId: account.userId, isAdmin: account.isAdmin, canAccessAdmin: account.canAccessAdmin } });
  }
  if (!show) return null;
  const previewing = Boolean(show.preview);
  // A private series isn't a podcast: its preview is /series/<id>.
  if (previewing && show.kind && show.kind !== 'podcast') return null;

  const age = previewing ? null : await getViewerAgeContext(account, req);
  // In the preview the viewer, not the tier, decides what plays (the rule
  // /api/stream-token follows): the team every row, the show's owner and a
  // row's uploader their rows, nobody but the team while the show is held.
  const team = Boolean(account.canAccessAdmin || account.isAdmin);
  const previewAccess = previewing ? { userId: account.userId || null, team, ownerId: show.creatorId || null, held: Boolean(show.held) } : null;
  const [rawEpisodes, allEpisodes] = await Promise.all([
    previewing
      ? getPodcastShowEpisodes(showId, true, null, { statuses: ['approved', 'pending'], preview: previewAccess })
      : getPodcastShowEpisodes(showId, account.isSubscriber || account.isAdmin, age),
    getPublicEpisodes()
  ]);
  // Nothing in a preview shows ads or counts (lib/podcastShow.js).
  const episodes = previewing ? rawEpisodes.map((e) => ({ ...e, adsEnabled: false })) : rawEpisodes;
  if (episodes.length === 0 && !previewing) return null;

  const mainGenres = [...new Set(allEpisodes.map((e) => e.mainGenre).filter(Boolean))];

  // Where a signed-in listener left each episode (seconds), from the same
  // Stripe-held progress the video player resumes from; only this show's
  // playable episodes. The persistent audio player (contexts/
  // PodcastPlayerContext.js) and the app's podcast screen seek to it.
  const progress = account.watchProgress || {};
  const resume = {};
  for (const ep of episodes) {
    const seconds = Number(progress[ep.id]);
    if (seconds > 0 && !ep.locked) resume[ep.id] = Math.floor(seconds);
  }

  let previewInfo = null;
  if (previewing) {
    const userId = account.userId || null;
    const role = userId && show.creatorId && userId === show.creatorId ? 'owner' : (account.canAccessAdmin || account.isAdmin ? 'team' : 'contributor');
    const state = showState(show, episodes.map((e) => ({ ...e, contentType: 'podcast' }))) || { key: 'empty', headline: null };
    let ownerName = null;
    if (show.creatorId) {
      const p = (await getPublicProfilesByIds([show.creatorId]).catch(() => ({})))[show.creatorId];
      ownerName = p && !p.isPlaceholder ? p.displayName : null;
    }
    const words = previewBarWords({ scope: 'show', role, state: state.key, headline: state.headline, ownerName, showName: show.name });
    previewInfo = {
      role,
      state: state.key,
      strong: words.strong,
      text: words.text,
      // The team's show page only for someone Admin → Shows opens for.
      linkHref: role === 'team' ? teamShowHref(account, show.id) : `/creator/show/${encodeURIComponent(show.id)}`,
      linkLabel: 'Open show page'
    };
  }

  return {
    show,
    episodes,
    resume: previewing ? {} : resume,
    preview: previewInfo,
    mainGenres,
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    adFree: Boolean(account.adFree),
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    email: account.email
  };
}
