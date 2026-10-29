// The app's half of lib/seriesResume.js — the words on a series' Play
// button and where it goes. The point itself (`resume`) is computed on
// the server and rides on /api/stream-feed, /api/type-feed and
// /api/genre-feed hero candidates and on /api/series-hub:
//   { episodeId, season, seriesOrder, resumeSeconds, state: 'first' | 'next' | 'resume' }
// (Jose, 2026-10-29: play the first episode before they start, continue
// where they are once they have.) Kept in step with the website by hand.

// "S1 E4" (the Continue Watching card's spelling), or null without a number.
export function episodeCode(ep) {
  if (!ep || !ep.seriesOrder) return null;
  return `S${ep.season || 1} E${ep.seriesOrder}`;
}

export function seriesPlayLabel(resume, firstLabel = 'Play first episode') {
  if (!resume || resume.state === 'first') return firstLabel;
  const code = episodeCode(resume);
  if (resume.state === 'resume') return code ? `Continue ${code}` : 'Continue watching';
  return code ? `Play ${code}` : 'Play next episode';
}

// Where a series hero's Play goes: the resume point's episode, else the
// show's first episode (a feed built for a signed-out viewer).
export function seriesPlayEpisodeId(hero) {
  if (!hero) return null;
  if (hero.resume && hero.resume.episodeId) return hero.resume.episodeId;
  return hero.firstEpisodeId || null;
}
