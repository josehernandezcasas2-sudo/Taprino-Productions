// The end card's cases and words — the app's copy of lib/endCardRules.js
// (keep the two in step by hand; the website's scripts/test-end-card.mjs
// covers the rule). endCardFor({ episode, nextEpisode, pick, seriesName,
// trailer }) → null (a trailer, a podcast) or { kind: next | season |
// show | film, seconds, headline: { kicker, title }, target, back }.
// `target` (what the timer opens) carries the episode `id`; `back`
// carries `seriesId` (the show's page) or null (Stream).
import { episodeCode } from './seriesResume';

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
