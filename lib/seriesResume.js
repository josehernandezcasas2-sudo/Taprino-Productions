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
//
// It is also where play order lives: sortEpisodes below is the one sorter
// for a show's episodes.

// --- play order: the one sorter ----------------------------------------------
// This block, down to "end of play order", is the same text in
// lib/seriesResume.js and mobile/src/lib/seriesResume.js;
// scripts/test-series-resume.mjs checks that and runs every case on both.
//
// Season first (none, 0, or anything that isn't a whole number above 0 is
// season 1), then the episode number (none, or 0, goes after the numbered
// episodes of its season), then the oldest first (no date goes after the
// dated ones), then the id. The last two settle duplicates — two episodes
// on the same season and number, which migration 118 moves out of the way
// — so a show comes out in the same order whatever order its rows arrived
// in. Reads the rows the pages and APIs hand around (season, seriesOrder,
// createdAt), the database's own (series_order, created_at) and a draft's
// (creator_drafts keeps the season and number in its form). The series
// revamp's rule (mockups/series-revamp-spec.md): every list of a show's
// episodes sorts with this, so Up next, the end card, the season strip,
// the series page, the hero, the channel engine and the show page agree.
// lib/showRules.js compareEpisodes is the same comparison in its own copy
// (that file imports nothing); the tests hold the two together.

function wholeAboveZero(v) {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function field(ep, camel, snake) {
  if (!ep || typeof ep !== 'object') return undefined;
  if (ep[camel] !== undefined) return ep[camel];
  if (snake && ep[snake] !== undefined) return ep[snake];
  if (ep.form && typeof ep.form === 'object' && ep.form[camel] !== undefined) return ep.form[camel];
  return undefined;
}

function playSeason(ep) {
  return wholeAboveZero(field(ep, 'season')) || 1;
}

function playNumber(ep) {
  return wholeAboveZero(field(ep, 'seriesOrder', 'series_order'));
}

function playTime(ep) {
  const v = field(ep, 'createdAt', 'created_at');
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function playId(ep) {
  return String(ep && ep.id !== undefined && ep.id !== null ? ep.id : '');
}

// The comparison, for code that sorts in place (list.sort(compareEpisodes)).
export function compareEpisodes(a, b) {
  const season = playSeason(a) - playSeason(b);
  if (season !== 0) return season;
  const na = playNumber(a);
  const nb = playNumber(b);
  if (na !== nb) {
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }
  const ta = playTime(a);
  const tb = playTime(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  const ia = playId(a);
  const ib = playId(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

// A sorted copy in play order; the list it is given is left as it was.
export function sortEpisodes(episodes) {
  return [...(episodes || [])].sort(compareEpisodes);
}

// --- end of play order -------------------------------------------------------

// "S1 E4" (the Continue Watching card's spelling), or null without a number.
export function episodeCode(ep) {
  if (!ep || !ep.seriesOrder) return null;
  return `S${ep.season || 1} E${ep.seriesOrder}`;
}

// `tier` says whether the episode it opens is free (the " · free" on a
// non-member's Play, freePlayNote below).
function point(ep, state, resumeSeconds) {
  return { episodeId: ep.id, season: ep.season || 1, seriesOrder: ep.seriesOrder || null, title: ep.title || null, resumeSeconds, state, tier: ep.tier === 'premium' ? 'premium' : 'free' };
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
// series page, where the episode is on screen). opts.free (freePlayNote)
// adds " · free" when it starts or picks up a free episode: "Play S1 E1 ·
// free", "Play first episode · free" — never on "Continue S1 E2" (they
// are already watching).
export function seriesPlayLabel(resume, firstLabel = 'Play first episode', opts = {}) {
  const free = Boolean(opts && opts.free === true);
  if (!resume || resume.state === 'first') return free ? `${firstLabel} · free` : firstLabel;
  const code = episodeCode(resume);
  if (resume.state === 'resume') return code ? `Continue ${code}` : 'Continue watching';
  const label = code ? `Play ${code}` : 'Play next episode';
  return free ? `${label} · free` : label;
}

// Whether a non-member's Play says " · free" (decision 10, option A): only
// in a mixed show (all-free and all-Tapa + shows say it once, in the
// hero's pill), never for a member or the owner of the whole series, and
// only when the episode it opens is free — the resume point's tier, or for
// a feed built without a viewer, whether the show's first episode is.
export function freePlayNote({ resume = null, rollup = null, isMember = false, ownsSeries = false } = {}) {
  if (!rollup || rollup.tier !== 'mixed' || isMember || ownsSeries) return false;
  if (resume) return resume.state !== 'resume' && resume.tier === 'free';
  return rollup.firstFree === true;
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
