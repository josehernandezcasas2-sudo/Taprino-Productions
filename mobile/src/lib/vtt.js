// Caption tracks for the app's episode player: a WebVTT file (what
// /api/captions/<id> serves, the website's <track>) as a list of cues, and
// which of them shows at a moment of the video. expo-video plays no
// side-loaded caption file, so components/EpisodePlayer.js draws the cue
// itself. Pure, and on purpose it imports nothing, so
// scripts/test-captions.mjs runs it in Node.
//
// Lenient where a browser's <track> would be strict and nothing is lost by
// it: the "WEBVTT" line may be missing, a comma may stand for the decimal
// point (an SRT that was never converted), hours are optional and the
// fraction may have one to three digits. Cue settings (`line:`, `align:`…)
// are ignored: the app always draws the cue at the bottom centre. Tags
// (<i>, <b>, <u>, <c.x>, <v Speaker>, <lang>, <ruby>, inline timestamps)
// are dropped, character references decoded. NOTE, STYLE and REGION
// blocks are skipped. Anything that isn't a cue gives no cue, so blank or
// garbage input (an error page, JSON) is an empty list.

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;
const ARROW = '-->';

// "01:02:03.500" → 3723.5, "02:03.5" → 123.5; null when it isn't one.
export function parseTimestamp(raw) {
  const m = TIMESTAMP.exec(String(raw == null ? '' : raw).trim());
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  const fraction = m[4] ? Number(`0.${m[4]}`) : 0;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

// A timing line ("00:01.000 --> 00:04.000 line:90% align:center") as
// { start, end }; null for any other line. The settings after the end
// time are ignored.
export function parseTiming(line) {
  const at = typeof line === 'string' ? line.indexOf(ARROW) : -1;
  if (at < 0) return null;
  const start = parseTimestamp(line.slice(0, at));
  const rest = line.slice(at + ARROW.length).trim();
  const end = parseTimestamp(rest.split(/[ \t]+/)[0]);
  if (start == null || end == null) return null;
  return { start, end };
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    const named = NAMED[ref.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// One payload line as plain text: every <…> tag dropped (a <v Speaker>'s
// name too, as a browser draws it), references decoded, spaces tidied.
export function cueLineText(raw) {
  return decodeEntities(String(raw == null ? '' : raw).replace(/<[^>]*>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

function isBlank(line) {
  return line.trim() === '';
}

// A block that only holds metadata: NOTE (a comment), STYLE, REGION.
function isMetaBlock(line) {
  return /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(line);
}

// The file as cues, earliest first (ties: the one that ends first):
// [{ start, end, text }], `text` the cue's lines joined with "\n". A cue
// with no text left after the tags go, or one that doesn't end after it
// starts, is left out.
export function parseVtt(input) {
  if (typeof input !== 'string' || !input) return [];
  const lines = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let i = 0;
  const skipBlock = () => { while (i < lines.length && !isBlank(lines[i])) i += 1; };
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i += 1; continue; }
    if (isMetaBlock(line)) { skipBlock(); continue; }
    // A block opens with its timing line, or with an identifier (the
    // "WEBVTT" header counts as one when no blank line follows it) and
    // then the timing line.
    let timing = parseTiming(line);
    if (!timing && i + 1 < lines.length && !isBlank(lines[i + 1])) {
      timing = parseTiming(lines[i + 1]);
      if (timing) i += 1;
    }
    if (!timing) { skipBlock(); continue; }
    i += 1;
    const text = [];
    // The cue's text runs to the next blank line; a line holding "-->"
    // that reads as a timing line starts the next cue (the WebVTT parser's
    // rule for a missing blank line).
    while (i < lines.length && !isBlank(lines[i])) {
      if (lines[i].includes(ARROW) && parseTiming(lines[i])) break;
      const clean = cueLineText(lines[i]);
      if (clean) text.push(clean);
      i += 1;
    }
    if (text.length && timing.end > timing.start) cues.push({ start: timing.start, end: timing.end, text: text.join('\n') });
  }
  return cues
    .map((c, n) => ({ c, n }))
    .sort((a, b) => a.c.start - b.c.start || a.c.end - b.c.end || a.n - b.n)
    .map(({ c }) => c);
}

// The cues ready to look up: `reach[j]` = the latest end among cues
// 0..j, so a lookup walks back only as far as a cue that could still be
// on screen.
export function captionTrack(cues) {
  const list = Array.isArray(cues) ? cues : [];
  const reach = [];
  let far = -Infinity;
  for (const c of list) {
    far = Math.max(far, c.end);
    reach.push(far);
  }
  return { cues: list, reach };
}

// Every cue on screen at `t` seconds (start ≤ t < end), earliest first.
// Stateless, so a seek either way, a pause or a jump back to the start
// just reads the cue there.
export function activeCues(track, t) {
  if (!track || !Array.isArray(track.cues) || !track.cues.length) return [];
  const time = Number(t);
  if (!Number.isFinite(time)) return [];
  const { cues, reach } = track;
  // The first cue that starts after t.
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) lo = mid + 1; else hi = mid;
  }
  const out = [];
  for (let j = lo - 1; j >= 0 && reach[j] > time; j -= 1) {
    if (cues[j].end > time) out.push(cues[j]);
  }
  return out.reverse();
}

// What the caption reads at `t`: the cues on screen, one above the other;
// '' when none is.
export function captionTextAt(track, t) {
  return activeCues(track, t).map((c) => c.text).join('\n');
}
