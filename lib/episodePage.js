import { getAuth } from '@clerk/nextjs/server';
import { getReleaseCrew } from './productions';
import { locationsForRelease } from './locationCredits';
import { findEpisode, findEpisodeForOwner, findEpisodeForPreview } from './episodes';
import { getOffer, getOwnership, ownsEpisode } from './purchases';
import { getPublicEpisodes, getShowEpisodesForPreview } from './publicEpisodes';
import { getBonusContentFor } from './bonusContent';
import { findSeries } from './series';
import { getAccountContext } from './accountContext';
import { getOwnProfile, getAiSealFlags, getPublicProfilesByIds } from './userProfiles';
import { clearsGate, requiredAgeFor, termsWouldClear } from './ageGate';
import { termsAcceptedFrom } from './viewerAge';
import { getRatings } from './ratings';
import { recordView, recordDailyView } from './redis';
import { firstInWindow, rateLimitKeyForRequest, looksLikeBot } from './rateLimit';
import { getWatchHistory, getWatchedIds } from './watchHistory';
import { getRecommendations } from './recommendations';
import { sortEpisodes } from './seriesResume';
import { getSiteSettings } from './siteSettings';
import { getReadyPlansByIds } from './adPlans';
import { adFreeContent } from './adBreakRules';
import { earlyAccessState } from './earlyAccess';
import { getTipping } from './tips';
import { payeeNowForEpisode } from './payees';
import { signTrailerSrc } from './heroCandidates';
import { extraGroups as groupExtras, previewBarWords, showState } from './showRules';
import { publicCreditLines, notesFrom as notesFromLines } from './publicCredits';
import { teamShowHref } from './seriesHub';

// A trailer's stored address never leaves the server (decision 12 of the
// series revamp, 2026-11-02): the titles listed around this one go out
// without theirs; each one's own page signs it.
function withoutStoredTrailer(e) {
  return e ? { ...e, trailerSrc: null } : e;
}

// Everything the episode page needs except the playable URL — shared by
// pages/episode/[id].js and the mobile app's GET /api/episode-page, so the
// view count, age gate, series next/previous, "Watch next" and bonus
// content can't drift between the two. Returns:
//   { notFound: true }
//   { ageRestricted: true, requiredRating, isSignedIn }
//   { episode, account, publicEpisodes, parentSeriesName, nextEpisode,
//     previousEpisode, previousEpisodeWatched, seasonEpisodes, watchNext,
//     afterShow, bonusContent }
// `episode` is the raw record, real `src` included — callers decide what
// (if anything) the viewer is entitled to receive. Its trailer is the one
// exception: it plays for anyone who can open the page (a free preview),
// so it is already signed here (decision 12 of the series revamp,
// 2026-11-02; lib/heroCandidates.js signTrailerSrc):
//   episode.trailerSrc        a signed link (60-minute token), or null —
//                             no trailer, or Cloudflare wouldn't sign it
//   episode.trailerExpiresAt  when that link stops working, or null
//   episode.trailerRef        { episodeId } for /api/stream-token's part
//                             'trailer' (a fresh link), null without one
// nextEpisode, previousEpisode, watchNext and bonusContent carry
// trailerSrc null.
//
// Slice 4 of the series revamp adds:
//   credits    the credit lines (decision 20; lib/publicCredits.js):
//              [{ key, label, name, href }] — "Made by Mara Reyes",
//              "Studio Harbor Films", "Producer Lux Tan"
//   notesFrom  whose notes the own page shows ("Notes from Mara"), or null
//   preview    with opts.preview (the link's ?preview=1) and an episode
//              that isn't live: its uploader, the show's owner and the
//              team get the page, with { role, status, held, canPlay,
//              strong, text, linkHref, linkLabel } for the bar — no age
//              gate, no early screening, no views counted, nothing for
//              sale, no tip, no end-card pick. Everyone else: notFound.
//              A public episode with ?preview=1 is the ordinary page.
//   bonusContent  the extras hung on this episode first (shelf order),
//              then, for a show's episode, the show's own.
export async function getEpisodePageData(id, req, { preview = false } = {}) {
  let episode = await findEpisode(id);
  // Buy to own: a title withdrawn by its creator is gone from the
  // catalogue but still opens for the people who bought it.
  let withdrawn = false;
  if (!episode) {
    const { userId: ownerId } = getAuth(req);
    const ownership = ownerId ? await getOwnership(ownerId).catch(() => null) : null;
    if (ownership && ownership.purchases.length) {
      const forOwner = await findEpisodeForOwner(id);
      if (forOwner && ownsEpisode(ownership, forOwner)) {
        episode = forOwner;
        withdrawn = true;
      }
    }
  }
  // The owner's private preview (decision 2, amendment 5; slice 4).
  let previewMeta = null;
  if (!episode && preview) {
    const ctx = await getAccountContext(req);
    if (ctx.isSignedIn) {
      const found = await findEpisodeForPreview(id, { userId: ctx.userId, isAdmin: ctx.isAdmin, canAccessAdmin: ctx.canAccessAdmin });
      if (found) {
        episode = found.episode;
        previewMeta = found.preview;
      }
    }
  }
  if (!episode) return { notFound: true };
  const previewing = Boolean(previewMeta);
  const previewViewer = previewing ? await getAccountContext(req) : null;
  // Episode Ad Curator: a ready plan with "on demand" on plays its breaks
  // as pods in the main player (components/VideoPlayer.js) instead of one
  // random ad per break. Never a podcast's: podcasts are ad-free
  // (lib/adBreakRules.js adFreeContent), whatever an older plan says.
  try {
    const plan = adFreeContent(episode.contentType) ? null : (await getReadyPlansByIds([episode.id]))[episode.id];
    episode.adPlan = plan && plan.onDemand ? { breaks: plan.breaks.map((b) => ({ index: b.index, at: b.at, booked: b.booked })), selfAds: plan.selfAds || [] } : null;
  } catch (err) {
    episode.adPlan = null;
  }

  const account = await getAccountContext(req);

  // Age gate — the actual access-control point, not just a listing filter.
  // Admins bypass; unknown age (signed out, or no age set) fails closed —
  // see lib/ageGate.js. pages/api/stream-token.js enforces the same rule.
  // A preview is the title's own people looking at it: no gate.
  if (!account.isAdmin && !previewing) {
    const profile = account.isSignedIn ? await getOwnProfile(account.userId) : null;
    const viewerAge = profile && profile.age != null ? profile.age : null;
    const ratings = await getRatings();
    const termsAccepted = termsAcceptedFrom(req);
    if (!clearsGate({ viewerAge, termsAccepted }, episode.rating, ratings)) {
      // requiredAge comes from the live ratings list, so a custom rating
      // (say, a 13+ one) is worded as 13+, not the built-in table's 17+.
      const requiredAge = requiredAgeFor(episode.rating, ratings);
      // No age on file and a title under 17+: the viewing terms unlock it,
      // so the page shows that confirmation instead of the account wall.
      const termsRequired = viewerAge == null && termsWouldClear(episode.rating, ratings);
      // What the gate page's <title> and link-preview tags say (a crawler
      // never carries the viewing-terms cookie, so it always lands here
      // for a rated title): the same words the page itself uses.
      const headShow = episode.seriesId ? await findSeries(episode.seriesId).catch(() => null) : null;
      const head = {
        title: episode.title ?? null,
        desc: episode.desc ?? null,
        season: episode.season ?? null,
        seriesOrder: episode.seriesOrder ?? null,
        seriesId: episode.seriesId ?? null,
        // og:type follows it (a film's video.movie, an episode's video.episode).
        contentType: episode.contentType ?? null,
        showName: headShow ? headShow.name ?? null : null,
        thumbnail: episode.thumbnail ?? null,
        poster: episode.poster ?? null
      };
      return { ageRestricted: true, termsRequired, requiredRating: episode.rating || 'Not Rated', requiredAge, isSignedIn: account.isSignedIn, head };
    }
  }

  // Early screenings (lib/earlyAccess.js): for 24 h after release only
  // Premium/Sponsor members, admins, the creator and buyers can play it.
  // Ownership is read once here and reused for the Buy to own offer below.
  const { userId: viewerId } = getAuth(req);
  let earlyAccess = { early: false, locked: false, opensAt: null };
  if (!previewing) try {
    const ownership = viewerId ? await getOwnership(viewerId) : null;
    const ownedForEarly = Boolean(ownership && ownsEpisode(ownership, episode));
    earlyAccess = earlyAccessState(episode, {
      tier: account.tier || 'basic',
      isAdmin: account.isAdmin,
      isCreator: Boolean(viewerId && episode.submittedBy === viewerId),
      owned: ownedForEarly
    });
  } catch (err) {
    console.error('episodePage early access error:', err.message);
  }

  // Counted only once the viewer can actually see the title (a hit on the
  // age-gate screen used to count as a view and feed "most viewed").
  // Awaited (not fire-and-forget) — on serverless, an un-awaited call can get
  // cut off the moment the response is sent. recordView already swallows its
  // own errors internally, so this never blocks the page on a Redis hiccup.
  // Once per viewer per title per day, and never for bots: these counts
  // rank Trending and, through creator_views, split Creator Share money
  // for members who haven't picked anyone, so a reload loop or a script
  // must not move them. Only signed-in views by someone other than the
  // creator count toward the creator's money total.
  // Who the title pays now (slice 3b, lib/payees.js): the pool's views are
  // counted under that account. When that can't be read, the view isn't
  // credited (never the old rule's account by mistake). Tips don't read it:
  // the Tip button tips the maker (below).
  // A preview never counts (the bar says so): nothing is read for it.
  const payee = previewing ? { payeeId: null } : await payeeNowForEpisode(episode.id).catch((err) => {
    console.error('episodePage payee:', err && err.message);
    return { payeeId: null, failed: true };
  });
  if (!previewing && !looksLikeBot(req)) {
    const viewer = account.userId || rateLimitKeyForRequest(req, 'viewer');
    if (await firstInWindow(`viewed:${episode.id}:${viewer}`, 86400)) {
      // A premium title behind the paywall wasn't watched, just visited;
      // neither was an early screening the viewer's plan can't open yet.
      const locked = (episode.tier === 'premium' && !account.isSubscriber && !account.isAdmin) || earlyAccess.locked;
      const creditCreator = account.userId && payee.payeeId && account.userId !== payee.payeeId && !locked ? payee.payeeId : null;
      await Promise.all([recordView(episode.id), recordDailyView(episode.id, creditCreator)]);
    }
  }

  const publicEpisodes = await getPublicEpisodes();
  // A preview reads the show the way its owner sees it: private, with its
  // episodes in review (lib/series.js findSeries, lib/publicEpisodes.js).
  const previewSeriesViewer = previewing ? { userId: previewViewer.userId, isAdmin: previewViewer.isAdmin, canAccessAdmin: previewViewer.canAccessAdmin } : null;
  const parentSeries = episode.seriesId ? await findSeries(episode.seriesId, previewing ? { preview: previewSeriesViewer } : {}).catch(() => null) : null;
  // What of the show the preview lists, and which of it this viewer may
  // open (`canOpen` on the strip, Up next, previous and the extras):
  //   the team and the show's owner   every approved or in-review title of
  //                                   the show, all of it openable;
  //   someone who only uploaded this  a private show: what their series
  //                                   preview lists (openable: their own);
  //                                   a public show: what anyone sees,
  //                                   plus their own titles — never another
  //                                   person's unreleased or pulled one.
  let showPool = publicEpisodes;
  let canOpen = null;
  if (previewing && episode.seriesId) {
    const rows = await getShowEpisodesForPreview(episode.seriesId);
    const fullView = previewMeta.viewerIsTeam === true || previewMeta.viewerIsShowOwner === true;
    const uid = previewViewer.userId || null;
    const mine = (e) => Boolean(uid && e && e.submittedBy === uid);
    const publicIds = new Set(publicEpisodes.map((e) => e.id));
    if (fullView || !previewMeta.showPublic) {
      showPool = rows;
    } else {
      const own = rows.filter(mine);
      const ownIds = new Set(own.map((e) => e.id));
      showPool = [...own, ...publicEpisodes.filter((e) => !ownIds.has(e.id))];
    }
    const openable = new Set(showPool.filter((e) => fullView || mine(e) || publicIds.has(e.id)).map((e) => e.id));
    openable.add(episode.id);
    canOpen = (id) => openable.has(id);
  }
  const withCanOpen = (e) => (e && canOpen ? { ...e, canOpen: canOpen(e.id) } : e);

  // Next/Previous only make sense for series content.
  let nextEpisode = null;
  let previousEpisode = null;
  let seriesEpisodes = [];
  if (episode.contentType === 'series' && episode.seriesId) {
    // Play order, the one sorter (lib/seriesResume.js): an episode with no
    // season is in season 1 (it used to sort before season 1 here, so Up
    // next and the series page disagreed), an unnumbered one comes after
    // the numbered ones.
    seriesEpisodes = sortEpisodes(showPool.filter((e) => e.contentType === 'series' && e.seriesId === episode.seriesId));
    const idx = seriesEpisodes.findIndex((e) => e.id === episode.id);
    if (idx !== -1) {
      nextEpisode = seriesEpisodes[idx + 1] || null;
      previousEpisode = seriesEpisodes[idx - 1] || null;
    }
  }

  const { userId } = getAuth(req);

  // The season this episode sits in, for the page's episode strip (Jose,
  // 2026-10-29, the "After Play" canvas): every episode of the season with
  // the viewer's state on it — finished (watch_history), partway through
  // (the Stripe-held watch progress, the Continue Watching source) and
  // which one is playing now. Standalone titles get an empty list.
  let seasonEpisodes = [];
  let previousEpisodeWatched = false;
  if (seriesEpisodes.length > 0) {
    const inSeason = seriesEpisodes.filter((e) => (e.season || 1) === (episode.season || 1));
    const watched = userId ? await getWatchedIds(userId, [...inSeason, previousEpisode].filter(Boolean).map((e) => e.id)) : new Set();
    const progress = account.watchProgress || {};
    previousEpisodeWatched = Boolean(previousEpisode && watched.has(previousEpisode.id));
    seasonEpisodes = inSeason.map((e) => ({
      id: e.id,
      title: e.title,
      season: e.season || 1,
      seriesOrder: e.seriesOrder || null,
      runtime: e.runtime || null,
      thumbnail: e.thumbnail || null,
      tier: e.tier,
      adsEnabled: e.adsEnabled !== false,
      watched: watched.has(e.id),
      resumeSeconds: Number(progress[e.id]) || 0,
      current: e.id === episode.id,
      ...(canOpen ? { canOpen: canOpen(e.id) } : {})
    }));
  }

  // Standalone content fills the sidebar with "Watch next": unwatched
  // wishlist items first, then personalized recommendations, capped at 4.
  let watchNext = [];
  let watchHistoryList = null;
  if (episode.contentType !== 'series' && userId && !previewing) {
    const browsable = publicEpisodes.filter((e) => e.contentType !== 'bonus' && e.id !== episode.id);
    watchHistoryList = await getWatchHistory(userId, browsable);
    const watchedIds = new Set(watchHistoryList.map((e) => e.id));
    const unwatchedWishlist = account.wishlist
      .map((wid) => browsable.find((e) => e.id === wid))
      .filter((e) => e && !watchedIds.has(e.id));
    const excludeIds = [...account.wishlist, ...watchHistoryList.map((e) => e.id), episode.id];
    const siteSettings = await getSiteSettings();
    const recommended = getRecommendations({
      episodes: browsable,
      tasteIds: [...account.wishlist, ...watchHistoryList.map((e) => e.id)],
      excludeIds,
      closeness: siteSettings.recommendationCloseness,
      count: 4
    });
    const seen = new Set();
    watchNext = [...unwatchedWishlist, ...recommended].filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, 4);
  }

  // The end card's pick (lib/endCardRules.js; Jose, 2026-10-30): when the
  // show is over, or a standalone title ends, one title to offer next.
  let afterShow = null;
  if (!previewing && episode.contentType !== 'podcast' && (episode.contentType !== 'series' || !nextEpisode)) {
    afterShow = await pickAfterShow({ episode, publicEpisodes, account, userId, watchHistoryList }).catch((err) => {
      console.error('episodePage afterShow error:', err.message);
      return null;
    });
  }

  // The Extras row (slice 4): the extras hung on this episode first, in
  // shelf order, then — for a show's episode — the show's own.
  const hungHere = groupExtras(getBonusContentFor(showPool, 'episode', episode.id), [episode]).flatMap((g) => g.items);
  const showOwn = episode.contentType === 'series' && episode.seriesId
    ? groupExtras(getBonusContentFor(showPool, 'series', episode.seriesId), []).flatMap((g) => g.items)
    : [];
  const bonusContent = [...hungHere, ...showOwn.filter((x) => !hungHere.some((h) => h.id === x.id))];

  // Buy to own: this title's price for this viewer (or that they own
  // it), and the whole-series bundle when it's an episode of one.
  let purchase = null;
  let bundle = null;
  if (!previewing) try {
    purchase = await getOffer({ type: 'episode', id: episode.id, userId: userId || null, isMember: account.isSubscriber });
    if (episode.seriesId && !purchase.owned) bundle = await getOffer({ type: 'series', id: episode.seriesId, userId: userId || null, isMember: account.isSubscriber });
  } catch (err) {
    console.error('episodePage offer error:', err.message);
  }

  // Tips (lib/tips.js): the episode's Tip button tips the title's MAKER,
  // whoever uploaded it (Jose, 2026-11-06), whatever account its other
  // earnings go to — only when the maker can take charges, never yourself.
  // It never reads who the title pays. With no button the answer carries
  // no account at all (who is paid, and the maker's payout state, aren't a
  // viewer's business).
  let tipping = { enabled: false, reason: null };
  if (episode.submittedBy) {
    tipping = await getTipping(episode.submittedBy, { viewerId: userId || null }).catch((err) => {
      console.error('episodePage getTipping:', err.message);
      return tipping;
    });
  }
  if (!tipping.enabled) tipping = { enabled: false, reason: tipping.reason || null };
  // Nothing is tipped in a preview (slice 4).
  if (previewing) tipping = { enabled: false, reason: 'preview' };

  // People credited through a production that released as this title (migration 104).
  const crew = await getReleaseCrew('episode', episode.id).catch(() => []);
  // Where it was shot ("Shot here" credits, migration 107).
  const shotAt = await locationsForRelease('episode', episode.id).catch(() => []);
  // The maker's "Not for AI training" seal (migration 111): shown unless
  // they switched it off; a title with no maker on record carries it too.
  const sealFlags = episode.submittedBy ? await getAiSealFlags([episode.submittedBy]).catch(() => ({})) : {};
  const aiSeal = episode.submittedBy ? sealFlags[episode.submittedBy] !== false : true;

  // The trailer, signed like the film (never its stored address; null when
  // Cloudflare wouldn't sign it, and the page shows the artwork instead).
  const storedTrailer = episode.trailerSrc || null;
  const trailer = storedTrailer ? await signTrailerSrc(storedTrailer) : null;
  episode = {
    ...episode,
    trailerSrc: trailer ? trailer.src : null,
    trailerExpiresAt: trailer ? trailer.expiresAt : null,
    // The trailer route refuses a title that isn't public, so a preview's
    // trailer can't be refreshed (it shows the artwork after the hour).
    trailerRef: storedTrailer && !previewing ? { episodeId: episode.id } : null
  };

  // The credit lines (decision 20) and whose notes the own page shows.
  const credits = await publicCreditLines({ episode, series: parentSeries }).catch((err) => {
    console.error('episodePage credits:', err && err.message);
    return [];
  });
  const notesFrom = notesFromLines(credits, credits.profiles);

  // The preview bar (lib/showRules.js previewBarWords). The show is the
  // one the episode belongs to — for an extra filed only through
  // bonus_parent_*, the show it hangs on (lib/episodes.js).
  let previewInfo = null;
  if (previewing) {
    const showId = previewMeta.showId || episode.seriesId || null;
    let ownerName = null;
    if (previewMeta.ownerId) {
      const owner = (await getPublicProfilesByIds([previewMeta.ownerId]).catch(() => ({})))[previewMeta.ownerId];
      ownerName = owner && !owner.isPlaceholder ? owner.displayName : null;
    }
    const state = previewMeta.showPublic ? { key: 'live' } : (parentSeries ? showState(parentSeries, seriesEpisodes) : null);
    const words = previewBarWords({
      scope: 'episode',
      role: previewMeta.role,
      state: state ? state.key : null,
      headline: state ? state.headline : null,
      ownerName,
      showName: previewMeta.showName,
      episodeStatus: previewMeta.status,
      held: previewMeta.held,
      removal: previewMeta.deletionRequested,
      standalone: !showId
    });
    previewInfo = {
      role: previewMeta.role,
      status: previewMeta.status,
      held: previewMeta.held,
      canPlay: previewMeta.canPlay,
      strong: words.strong,
      text: words.text,
      // The team's show page only for someone Admin → Shows opens for.
      linkHref: showId
        ? (previewMeta.role === 'team' ? teamShowHref(previewViewer, showId) : `/creator/show/${encodeURIComponent(showId)}`)
        : (previewMeta.role === 'team' ? null : '/creator/my-work'),
      linkLabel: showId ? 'Open show page' : 'Open Your work'
    };
  }

  return {
    episode,
    crew,
    shotAt,
    withdrawn,
    purchase,
    bundle,
    earlyAccess,
    tipping,
    aiSeal,
    account,
    publicEpisodes,
    parentSeriesName: parentSeries ? parentSeries.name : null,
    nextEpisode: withCanOpen(withoutStoredTrailer(nextEpisode)),
    previousEpisode: withCanOpen(withoutStoredTrailer(previousEpisode)),
    previousEpisodeWatched,
    seasonEpisodes,
    // How many episodes the show has as this viewer sees it (the strip's
    // "only episode" line names the season when there are others).
    showEpisodeCount: seriesEpisodes.length,
    watchNext: watchNext.map(withoutStoredTrailer),
    afterShow,
    bonusContent: bonusContent.map((b) => withCanOpen(withoutStoredTrailer(b))),
    credits,
    notesFrom,
    preview: previewInfo
  };
}

// One title for the end card once the show is over (or a film ended):
// the same picks as the "Watch next" row under a film — the viewer's
// unwatched My List items first, then a recommendation by taste
// (lib/recommendations.js) — never this title, this show, a podcast or
// bonus content; signed out, or with nothing watched or saved, the
// newest title on Stream. A pick that belongs to a series opens at that
// series' first episode and is named after the show.
async function pickAfterShow({ episode, publicEpisodes, account, userId, watchHistoryList }) {
  const candidates = publicEpisodes.filter((e) => e.contentType !== 'bonus' && e.contentType !== 'podcast' && e.id !== episode.id && !(episode.seriesId && e.seriesId === episode.seriesId));
  if (candidates.length === 0) return null;
  let pick = null;
  if (userId) {
    const history = watchHistoryList || await getWatchHistory(userId, candidates);
    const watchedIds = new Set(history.map((e) => e.id));
    const wishlist = (account.wishlist || [])
      .map((wid) => candidates.find((e) => e.id === wid || e.seriesId === wid))
      .filter((e) => e && !watchedIds.has(e.id));
    pick = wishlist[0] || null;
    if (!pick) {
      const siteSettings = await getSiteSettings();
      [pick] = getRecommendations({
        episodes: candidates,
        tasteIds: [...(account.wishlist || []), ...history.map((e) => e.id), episode.seriesId || episode.id],
        excludeIds: history.map((e) => e.id),
        closeness: siteSettings.recommendationCloseness,
        count: 1
      });
    }
  }
  if (!pick) pick = [...candidates].sort((a, b) => (Date.parse(b.releasedAt) || 0) - (Date.parse(a.releasedAt) || 0))[0];
  if (!pick) return null;
  if (pick.contentType === 'series' && pick.seriesId) {
    const first = sortEpisodes(candidates.filter((e) => e.seriesId === pick.seriesId))[0] || pick;
    const series = await findSeries(pick.seriesId).catch(() => null);
    return shapePick(first, series ? series.name : null);
  }
  return shapePick(pick, null);
}

function shapePick(e, seriesName) {
  return {
    id: e.id,
    title: seriesName || e.title,
    contentType: e.contentType,
    seriesId: e.seriesId || null,
    season: e.season || null,
    seriesOrder: e.seriesOrder || null,
    thumbnail: e.thumbnail || null,
    poster: e.poster || null,
    runtime: e.runtime || null,
    genre: e.genre || e.mainGenre || null,
    releaseYear: e.releaseYear || null,
    rating: e.rating || null,
    tier: e.tier || 'free',
    adsEnabled: e.adsEnabled !== false
  };
}
