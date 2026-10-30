// The end card — what comes up over the player when a title plays out
// (Jose, 2026-10-30: "a screen with a timer that will show the next
// episode or show if we're at the end of the season. Have a button on
// the bottom left to skip to the next episode"; built from the signed-off
// boards on the After Play canvas). Pure and client-safe: the website's
// components/EndCard.js and the app's mobile/src/components/EndCard.js
// draw what this returns, and mobile/src/lib/endCardRules.js mirrors it
// by hand, so the cases and the words can't drift between the two.
//
// endCardFor({ episode, nextEpisode, pick, seriesName, trailer }) → null
// (no card: a trailer, a podcast) or
//   { kind, seconds, headline: { kicker, title }, target, back }
// where `kind` is
//   next   — a series episode with one after it in the same season;
//   season — the last episode of a season that has a season after it
//            (the next one is that season's first episode);
//   show   — the last episode of the show: `target` is one title picked
//            for the viewer (lib/episodePage.js afterShow), `back` the
//            show's page;
//   film   — a standalone title (a film, a short, a clip): the same pick,
//            `back` is Stream.
// `target` is what the timer opens — { id, href, kicker, title, thumbnail,
// runtime, genre, releaseYear, rating, tier, adsEnabled } — or null when
// there is nothing to pick (then `seconds` is 0 and the card only says
// the show is over). `seconds` is the countdown; PLAY NOW skips it, the
// × ("stay") stops it.
import { episodeCode } from './seriesResume.js'; // explicit .js so plain Node can run the tests

export const END_CARD_SECONDS = 10;
export const PLAY_NOW_LABEL = 'Play now';
export const STAY_LABEL = 'Stay on this episode';

const TYPE_WORD = { movie: 'Film', short: 'Short', vertical: 'Vertical', series: 'Series', bonus: 'Bonus' };

export function playingInLabel(seconds) {
  return `Playing in ${Math.max(0, Math.round(seconds))} s`;
}

function targetFields(e) {
  return {
    id: e.id,
    href: `/episode/${e.id}?autoplay=1`,
    title: e.title || '',
    thumbnail: e.thumbnail || e.poster || null,
    runtime: e.runtime || null,
    genre: e.genre || e.mainGenre || null,
    releaseYear: e.releaseYear || null,
    rating: e.rating || null,
    tier: e.tier || 'free',
    adsEnabled: e.adsEnabled !== false
  };
}

// "Season 1 · Episode 3" for the kicker; null without a number.
function seasonEpisodeWords(e) {
  if (!e || !e.seriesOrder) return null;
  return `Season ${e.season || 1} · Episode ${e.seriesOrder}`;
}

export function endCardFor({ episode, nextEpisode = null, pick = null, seriesName = null, trailer = false, seconds = END_CARD_SECONDS }) {
  if (!episode || trailer) return null;
  if (episode.contentType === 'podcast') return null;
  const isSeries = episode.contentType === 'series' && Boolean(episode.seriesId);
  const show = seriesName || 'this show';

  if (isSeries && nextEpisode) {
    const newSeason = (nextEpisode.season || 1) > (episode.season || 1);
    if (newSeason) {
      return {
        kind: 'season',
        seconds,
        headline: { kicker: `That was the last episode of Season ${episode.season || 1}`, title: show },
        target: { kicker: `Season ${nextEpisode.season || 1} starts · Episode ${nextEpisode.seriesOrder || 1}`, ...targetFields(nextEpisode) },
        back: null
      };
    }
    return {
      kind: 'next',
      seconds,
      headline: { kicker: ['That was', seriesName, episodeCode(episode)].filter(Boolean).join(' · '), title: episode.title || '' },
      target: { kicker: ['Up next', seasonEpisodeWords(nextEpisode)].filter(Boolean).join(' · '), ...targetFields(nextEpisode) },
      back: null
    };
  }

  const target = pick ? { kicker: `Try this next · ${TYPE_WORD[pick.contentType] || 'Short'}`, ...targetFields(pick) } : null;
  if (isSeries) {
    return {
      kind: 'show',
      seconds: target ? seconds : 0,
      headline: { kicker: 'That was the last episode', title: [show, episode.season ? `Season ${episode.season}` : null].filter(Boolean).join(' · ') },
      target,
      back: { label: `Back to ${show}`, href: `/series/${episode.seriesId}`, seriesId: episode.seriesId }
    };
  }
  return {
    kind: 'film',
    seconds: target ? seconds : 0,
    headline: { kicker: 'That was', title: episode.title || '' },
    target,
    back: { label: 'Browse Stream', href: '/stream', seriesId: null }
  };
}
