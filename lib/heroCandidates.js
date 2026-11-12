import { signedSrcForStoredUrl, unsignedFallback } from './videoSigning';
import { episodeCode, sortEpisodes } from './seriesResume';
import { seasonHero } from './seasonArt';

// Builds the pool of things eligible to show in a hero carousel — standalone
// movies/shorts stay as themselves, but series episodes never appear
// individually. Instead, all views across a series' episodes roll up into
// one aggregate candidate for the series itself, competing on equal footing
// with standalone content for the featured slot. The idea: a popular SHOW
// should pull people into bingeing it, not just its single most-watched
// episode.
//
// `allSeries` is passed in rather than imported directly — series.js is now
// a Supabase-backed async module, and the caller already has this data
// fetched (or can fetch it once and reuse it) rather than this function
// making its own redundant query.
//
// SERVER-ONLY module: signTrailerSrc / signHeroTrailers below mint playback
// tokens. Pages import it inside getServerSideProps only, like the feeds.
//
// Trailers (decision 12 of the series revamp, 2026-11-02): a trailer plays
// through a signed link like the film itself, never its stored address.
// A candidate carries:
//   trailerSrc        null, or a signed link once signHeroTrailers ran
//   trailerExpiresAt  when that link stops working (unix seconds), or null
//   trailerRef        { episodeId } | { seriesId } — what to ask
//                     /api/stream-token for (part 'trailer') when the
//                     link is missing or has expired; null = no trailer
// The stored address rides along under a symbol for signHeroTrailers only:
// JSON (an API answer) and Next's page props skip symbol keys, so it never
// reaches a browser or the app.
const STORED_TRAILER = Symbol('storedTrailer');

// A trailer's token outlives the 300 s (+600 s stale) CDN cache of the
// signed-out pages that carry it, with room to spare; the hero asks for a
// fresh one through /api/stream-token when it runs out.
export const TRAILER_TOKEN_SECONDS = 60 * 60;

function withTrailer(candidate, stored, ref) {
  candidate.trailerSrc = null;
  candidate.trailerExpiresAt = null;
  candidate.trailerRef = stored ? ref : null;
  if (stored) candidate[STORED_TRAILER] = stored;
  return candidate;
}

export function buildHeroCandidates(episodeList, allSeries, viewCounts = {}) {
  const standalone = episodeList
    .filter((e) => e.contentType !== 'series')
    .map((e) => withTrailer({
      id: e.id,
      isSeries: false,
      // contentType/seriesId drive where a hero's buttons go (a podcast
      // opens its show page, not the video page); isOriginal shows the
      // Tapa Original tag. All three used to be dropped here, so every
      // podcast branch downstream was dead.
      contentType: e.contentType || null,
      seriesId: e.seriesId || null,
      isOriginal: !!e.isOriginal,
      title: e.title,
      desc: e.desc,
      runtime: e.runtime,
      tier: e.tier,
      genre: e.genre,
      mainGenre: e.mainGenre,
      artist: e.artist,
      rating: e.rating,
      // SECURITY: the trailer only — trailers are meant to be freely
      // previewable by design, but the hero must never play the full
      // protected episode as ambient background for an unentitled visitor.
      // If an episode has no trailer, it just won't autoplay video in the
      // hero (heroImage or a static treatment covers that case instead).
      heroImage: e.heroImage,
      poster: e.poster,
      thumbnail: e.thumbnail,
      titleImageUrl: e.titleImageUrl,
      featured: !!e.featured,
      releaseYear: e.releaseYear || null,
      adsEnabled: e.adsEnabled !== false,
      views: viewCounts[e.id] || 0
    }, e.trailerSrc || null, { episodeId: e.id }));

  const seriesIdsPresent = [...new Set(episodeList.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];
  const seriesCandidates = seriesIdsPresent
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      if (!info) return null;
      // Play order, the one sorter (lib/seriesResume.js).
      const eps = sortEpisodes(episodeList.filter((e) => e.seriesId === sid));
      const totalViews = eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0);
      // The show's first episode in play order (not S2E1 because it
      // happened to be first in the list).
      const repEpisode = eps[0];
      // Same rule — a trailer only, never a full episode's real src: the
      // show's own, else its first episode's.
      const ownTrailer = info.trailerSrc || null;
      const repTrailer = repEpisode ? repEpisode.trailerSrc || null : null;
      // What viewers see of the show (decision 10; lib/showRollups.js,
      // attached by the caller from every public episode, not this pool's
      // subset): the "Tapa +" pill and the green "E1 free" chip, the
      // highest rating, and whether the first episode is free (the
      // " · free" on a non-member's Play).
      const rollup = info.rollup || null;
      // The newest released season's art is the hero while the show's
      // switch is on (migration 122): attachShowRollups decides it from
      // every public episode; without it, this pool's episodes do.
      const fromSeason = info.seasonHero !== undefined ? info.seasonHero : seasonHero(info, eps);
      return withTrailer({
        id: info.id,
        isSeries: true,
        title: info.name,
        desc: info.desc,
        runtime: `${eps.length} episode${eps.length === 1 ? '' : 's'}`,
        tier: rollup ? (rollup.tier === 'free' ? 'free' : 'premium') : (eps.some((e) => e.tier === 'premium') ? 'premium' : 'free'),
        tierLabel: rollup ? rollup.tierLabel : null,
        freeLabel: rollup ? rollup.freeLabel : null,
        rollupTier: rollup ? rollup.tier : null,
        firstFree: rollup ? rollup.firstFree === true : false,
        firstCode: repEpisode ? episodeCode(repEpisode) : null,
        genre: null,
        mainGenre: repEpisode ? repEpisode.mainGenre : null,
        artist: null,
        rating: rollup && rollup.rating && rollup.rating !== 'Not Rated' ? rollup.rating : null,
        heroImage: (fromSeason && fromSeason.image) || info.heroImage || (repEpisode && repEpisode.heroImage),
        poster: info.poster || (repEpisode && repEpisode.poster),
        thumbnail: info.thumbnail || (repEpisode && repEpisode.thumbnail),
        titleImageUrl: info.titleImageUrl || (repEpisode && repEpisode.titleImageUrl),
        // Lets the Play button jump straight into watching (episode 1)
        // instead of the series' own overview page. Null only if a series
        // somehow has zero episodes, which can't really happen here since
        // seriesIdsPresent is derived from episodes that already exist,
        // but the fallback in goToEpisode/[type].js still checks it.
        firstEpisodeId: repEpisode ? repEpisode.id : null,
        featured: eps.some((e) => e.featured),
        releaseYear: info.releaseYear || null,
        // A show reads as "ad-free" only if every episode in it is —
        // one ad-supported episode is enough to call the whole thing
        // ad-supported, same reasoning as the tier rollup just above.
        adsEnabled: eps.some((e) => e.adsEnabled !== false),
        views: totalViews
      }, ownTrailer || repTrailer, ownTrailer ? { seriesId: info.id } : (repEpisode ? { episodeId: repEpisode.id } : null));
    })
    .filter(Boolean);

  return [...standalone, ...seriesCandidates];
}

// A playable link for a stored trailer address: a signed one (a 60-minute
// token), else — for a file that isn't on Cloudflare or Bunny, or a local
// run without Cloudflare — the stored address itself; null for a
// Cloudflare video whose token couldn't be minted, so a player falls back
// to the artwork instead of the permanent address (lib/videoSigning.js
// unsignedFallback, the rule every master follows).
//   → { src, expiresAt (unix seconds) | null, signed } | null
export async function signTrailerSrc(storedUrl) {
  if (!storedUrl || typeof storedUrl !== 'string') return null;
  const signed = await signedSrcForStoredUrl(storedUrl, { expiresInSeconds: TRAILER_TOKEN_SECONDS });
  if (signed && signed.src) return { src: signed.src, expiresAt: signed.expiresAt || null, signed: true };
  const fallback = unsignedFallback(storedUrl);
  return fallback ? { src: fallback, expiresAt: null, signed: false } : null;
}

// How long a page waits on one hero's link. Without the signing key in
// the environment every link is a call to Cloudflare's API, which has no
// timeout of its own, and the browse pages (/stream, /genre, /type) and
// the app's feeds render on the answer: a stalled API must cost a hero its
// trailer, not the whole page. The call carries on, and its token is
// reused once it lands.
const SIGN_BUDGET_MS = 2500;

function signWithinBudget(stored) {
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SIGN_BUDGET_MS); });
  return Promise.race([signTrailerSrc(stored).catch(() => null), late]).finally(() => clearTimeout(timer));
}

// Signs the trailer of every candidate in a hero pool (after
// buildHeroCandidates, ranking and withSeriesResume): one token per
// trailer, reused for ten minutes per video by lib/cloudflareUpload.js.
// A candidate whose trailer couldn't be signed (or not within
// SIGN_BUDGET_MS) keeps trailerSrc null; the website's hero then asks
// /api/stream-token itself (trailerRef), the app's shows the artwork.
export async function signHeroTrailers(pool) {
  return Promise.all((pool || []).map(async (candidate) => {
    const stored = candidate ? candidate[STORED_TRAILER] : null;
    if (!stored) return candidate;
    const signed = await signWithinBudget(stored);
    return { ...candidate, trailerSrc: signed ? signed.src : null, trailerExpiresAt: signed ? signed.expiresAt : null };
  }));
}
