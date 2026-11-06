// The app's half of lib/seriesResume.js — the words on a series' Play
// button and where it goes. The point itself (`resume`) is computed on
// the server and rides on /api/stream-feed, /api/type-feed and
// /api/genre-feed hero candidates and on /api/series-hub:
//   { episodeId, season, seriesOrder, resumeSeconds, state: 'first' | 'next' | 'resume' }
// (Jose, 2026-10-29: play the first episode before they start, continue
// where they are once they have.) Kept in step with the website by hand;
// the play-order block below is the website's text word for word, and
// scripts/test-series-resume.mjs checks that and runs its cases on both
// copies. Imports nothing, so the test can load it as it stands.

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

// The button's words (the website's seriesPlayLabel, word for word):
// opts.free (freePlayNote) adds " · free" when it starts or picks up a
// free episode — "Play S1 E1 · free", "Play first episode · free" — never
// on "Continue S1 E2". The server's resume point carries `tier`.
export function seriesPlayLabel(resume, firstLabel = 'Play first episode', opts = {}) {
  const free = Boolean(opts && opts.free === true);
  if (!resume || resume.state === 'first') return free ? `${firstLabel} · free` : firstLabel;
  const code = episodeCode(resume);
  if (resume.state === 'resume') return code ? `Continue ${code}` : 'Continue watching';
  const label = code ? `Play ${code}` : 'Play next episode';
  return free ? `${label} · free` : label;
}

// Whether a non-member's Play says " · free" (decision 10, option A): a
// mixed show only, never for a member or the owner of the whole series,
// and only when the episode it opens is free (the resume point's tier, or
// for a hero with no viewer, rollup.firstFree).
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
