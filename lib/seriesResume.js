// Where a viewer picks a show back up (Jose, 2026-10-29: a series' Play
// button plays the first episode for someone who hasn't started the show,
// and once they have, it changes to continue where they are).
//
// Pure and client-safe: the website's hero, the series page and the app
// (mobile/src/lib/seriesResume.js mirrors the words) all read the same
// point. `viewer` is what lib/continueWatching.js getViewerProgress()
// returns for a signed-in person — `progress` { episodeId: seconds } (the
// Continue Watching source: only episodes at least 10 s in and not yet
// finished are in it, the most recent last) and `watched`, the ids of
// episodes they finished (watch_history) — or null when signed out.

// Play order: season first, then episode number.
export function sortEpisodes(episodes) {
  return [...(episodes || [])].sort((a, b) => ((a.season || 1) - (b.season || 1)) || ((a.seriesOrder || 0) - (b.seriesOrder || 0)));
}

// "S1 E4" (the Continue Watching card's spelling), or null without a number.
export function episodeCode(ep) {
  if (!ep || !ep.seriesOrder) return null;
  return `S${ep.season || 1} E${ep.seriesOrder}`;
}

function point(ep, state, resumeSeconds) {
  return { episodeId: ep.id, season: ep.season || 1, seriesOrder: ep.seriesOrder || null, title: ep.title || null, resumeSeconds, state };
}

// The episode a series' Play button opens, and why:
//   resume — an episode of the show is in progress (the most recent one);
//   next   — nothing in progress, but they finished some of it: the
//            episode after the furthest one they finished;
//   first  — the first episode (not started, everything finished, or
//            signed out).
// Null for a show with no episodes.
export function seriesResumePoint(episodes, viewer) {
  const sorted = sortEpisodes(episodes);
  if (sorted.length === 0) return null;
  const progress = (viewer && viewer.progress) || {};
  const ids = new Set(sorted.map((e) => e.id));
  const inProgressId = Object.keys(progress).reverse().find((id) => ids.has(id) && Number(progress[id]) > 0);
  if (inProgressId) {
    return point(sorted.find((e) => e.id === inProgressId), 'resume', Math.floor(Number(progress[inProgressId])));
  }
  const watched = viewer && viewer.watched ? viewer.watched : null;
  if (watched && (watched.size || watched.length)) {
    const has = (id) => (typeof watched.has === 'function' ? watched.has(id) : watched.includes(id));
    let furthest = -1;
    sorted.forEach((e, i) => { if (has(e.id)) furthest = i; });
    if (furthest >= 0 && furthest + 1 < sorted.length) return point(sorted[furthest + 1], 'next', 0);
  }
  return point(sorted[0], 'first', 0);
}

// The button's words. `firstLabel` is what the caller says for an
// unstarted show ("Play first episode" on a hero, "Play S1 E1" on the
// series page, where the episode is on screen).
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

// Attaches `resume` to every series candidate of a hero pool (the web
// pages and feeds build the pool first, then stamp the viewer on it).
export function withSeriesResume(heroPool, episodes, viewer) {
  if (!viewer) return heroPool;
  return (heroPool || []).map((hero) => {
    if (!hero || !hero.isSeries) return hero;
    const eps = (episodes || []).filter((e) => e.seriesId === hero.id && e.contentType !== 'bonus');
    return { ...hero, resume: seriesResumePoint(eps, viewer) };
  });
}
