// node scripts/test-captions.mjs — the app's caption tracks
// (mobile/src/lib/vtt.js): a WebVTT file as cues, and which cue the
// episode player draws at a moment of the video.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// mobile/package.json has no "type": "module" (Metro doesn't need one), so
// load the source as an explicit ES module (scripts/test-hosted-auth.mjs).
const source = readFileSync(new URL('../mobile/src/lib/vtt.js', import.meta.url), 'utf8');
const { parseVtt, parseTimestamp, parseTiming, cueLineText, captionTrack, activeCues, captionTextAt } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const at = (cues, s) => captionTextAt(captionTrack(cues), s);

t('the file imports nothing (the test loads it on its own)', () => {
  assert.ok(!/^\s*import\s/m.test(source));
});

t('timestamps with and without hours, and the fraction', () => {
  assert.equal(parseTimestamp('00:01.000'), 1);
  assert.equal(parseTimestamp('01:02.500'), 62.5);
  assert.equal(parseTimestamp('01:02:03.250'), 3723.25);
  assert.equal(parseTimestamp('100:00:00.000'), 360000);
  assert.equal(parseTimestamp('00:00:05,5'), 5.5);
  assert.equal(parseTimestamp('00:07'), 7);
  assert.equal(parseTimestamp('00:60.000'), null);
  assert.equal(parseTimestamp('60:00.000'), null);
  assert.equal(parseTimestamp('nonsense'), null);
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp(null), null);
});

t('a timing line ignores the cue settings after the end time', () => {
  assert.deepEqual(parseTiming('00:01.000 --> 00:04.000 line:90% position:50% align:center'), { start: 1, end: 4 });
  assert.deepEqual(parseTiming('00:00:01.000-->00:00:02.500'), { start: 1, end: 2.5 });
  assert.equal(parseTiming('Hello there'), null);
  assert.equal(parseTiming('a --> b'), null);
});

t('a plain file: header, identifiers, two cues', () => {
  const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nWhere are we going?\n\n2\n00:00:05.000 --> 00:00:07.500\nHome.\n');
  assert.deepEqual(cues, [
    { start: 1, end: 4, text: 'Where are we going?' },
    { start: 5, end: 7.5, text: 'Home.' }
  ]);
});

t('timestamps without hours, and a header with metadata lines', () => {
  const cues = parseVtt('WEBVTT - Night Bus\nKind: captions\nLanguage: en\n\n00:01.000 --> 00:02.000\nOne\n\n01:02.000 --> 01:03.000\nTwo');
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[1, 2, 'One'], [62, 63, 'Two']]);
});

t('a multi-line cue keeps its lines', () => {
  const cues = parseVtt('WEBVTT\n\n00:00:10.000 --> 00:00:13.000\n- Did you hear that?\n- Hear what?\n');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, '- Did you hear that?\n- Hear what?');
});

t('cue settings are ignored, the cue is kept', () => {
  const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000 line:0 align:start size:40%\nUp top on the website, at the bottom here\n');
  assert.deepEqual(cues, [{ start: 1, end: 2, text: 'Up top on the website, at the bottom here' }]);
});

t('<i>, <b>, <u>, <c.x>, <v Speaker>, <lang> and inline timestamps are stripped', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:03.000\n<v Mara>I <i>told</i> you, <b>twice</b>.</v>\n<c.yellow><u>Really</u></c> <00:02.000><lang es>sí</lang>\n');
  assert.equal(cues[0].text, 'I told you, twice.\nReally sí');
  assert.equal(cueLineText('<v.loud Dee Park>Hey!'), 'Hey!');
});

t('character references are decoded', () => {
  assert.equal(cueLineText('Tom &amp; Jerry &lt;3 &#233;t&#xE9; &nbsp;x&lrm;'), 'Tom & Jerry <3 été x');
  assert.equal(cueLineText('&unknown; stays'), '&unknown; stays');
});

t('a byte-order mark and Windows / old Mac line endings', () => {
  const crlf = parseVtt('﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\nthere\r\n\r\n00:00:03.000 --> 00:00:04.000\r\nAgain\r\n');
  assert.deepEqual(crlf.map((c) => c.text), ['Hello\nthere', 'Again']);
  const cr = parseVtt('WEBVTT\r\r00:01.000 --> 00:02.000\rOld Mac\r');
  assert.deepEqual(cr.map((c) => c.text), ['Old Mac']);
});

t('NOTE, STYLE and REGION blocks are skipped', () => {
  const cues = parseVtt('WEBVTT\n\nSTYLE\n::cue { color: lime }\n\nNOTE a comment\nspanning lines\n\nREGION\nid:fred\n\n00:01.000 --> 00:02.000\nKept\n');
  assert.deepEqual(cues.map((c) => c.text), ['Kept']);
});

t('no blank line between the header and the first cue, or between two cues', () => {
  const cues = parseVtt('WEBVTT\n00:01.000 --> 00:02.000\nFirst\n00:02.000 --> 00:03.000\nSecond\n');
  assert.deepEqual(cues.map((c) => [c.start, c.text]), [[1, 'First'], [2, 'Second']]);
});

t('a file without the WEBVTT line, and an SRT-style comma', () => {
  const cues = parseVtt('1\n00:00:01,000 --> 00:00:02,000\nFrom an SRT\n');
  assert.deepEqual(cues, [{ start: 1, end: 2, text: 'From an SRT' }]);
});

t('blank and garbage input give no cues', () => {
  assert.deepEqual(parseVtt(''), []);
  assert.deepEqual(parseVtt('   \n\n  '), []);
  assert.deepEqual(parseVtt('WEBVTT\n'), []);
  assert.deepEqual(parseVtt('{"error":"Not found"}'), []);
  assert.deepEqual(parseVtt('<!doctype html><html><body>Oops --> nope</body></html>'), []);
  assert.deepEqual(parseVtt(null), []);
  assert.deepEqual(parseVtt(undefined), []);
  assert.deepEqual(parseVtt(42), []);
  assert.deepEqual(parseVtt({ cues: [] }), []);
});

t('a cue with no text, or one that ends before it starts, is left out', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\n<i></i>\n\n00:05.000 --> 00:04.000\nBackwards\n\n00:06.000 --> 00:06.000\nZero\n\n00:07.000 --> 00:08.000\nKept\n');
  assert.deepEqual(cues.map((c) => c.text), ['Kept']);
});

t('out-of-order cues come back earliest first', () => {
  const cues = parseVtt('WEBVTT\n\n00:05.000 --> 00:06.000\nLater\n\n00:01.000 --> 00:02.000\nEarlier\n');
  assert.deepEqual(cues.map((c) => c.text), ['Earlier', 'Later']);
});

t('the cue at a moment: start inclusive, end exclusive, gaps empty', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:04.000\nOne\n\n00:05.000 --> 00:07.500\nTwo\n');
  assert.equal(at(cues, 0), '');
  assert.equal(at(cues, 0.999), '');
  assert.equal(at(cues, 1), 'One');
  assert.equal(at(cues, 3.99), 'One');
  assert.equal(at(cues, 4), '');
  assert.equal(at(cues, 4.5), '');
  assert.equal(at(cues, 5), 'Two');
  assert.equal(at(cues, 7.4), 'Two');
  assert.equal(at(cues, 7.5), '');
  assert.equal(at(cues, 9999), '');
});

t('seeking: a jump back, a jump forward and a pause read the cue there (no state)', () => {
  const track = captionTrack(parseVtt('WEBVTT\n\n00:10.000 --> 00:12.000\nA\n\n01:00.000 --> 01:02.000\nB\n\n10:00.000 --> 10:05.000\nC\n'));
  assert.equal(captionTextAt(track, 600.5), 'C');
  assert.equal(captionTextAt(track, 10.5), 'A');
  assert.equal(captionTextAt(track, 61), 'B');
  assert.equal(captionTextAt(track, 61), 'B');
  assert.equal(captionTextAt(track, 0), '');
});

t('overlapping cues all show, the earlier one on top, a long one found from far after it starts', () => {
  const cues = parseVtt('WEBVTT\n\n00:00.000 --> 01:00.000\n[Rain]\n\n00:10.000 --> 00:12.000\nShort one\n\n00:20.000 --> 00:21.000\nAnother\n');
  const track = captionTrack(cues);
  assert.equal(captionTextAt(track, 11), '[Rain]\nShort one');
  assert.equal(captionTextAt(track, 20.5), '[Rain]\nAnother');
  assert.equal(captionTextAt(track, 30), '[Rain]');
  assert.equal(captionTextAt(track, 60), '');
  assert.deepEqual(activeCues(track, 11).map((c) => c.text), ['[Rain]', 'Short one']);
});

t('the lookup survives an empty track, a missing one and a bad time', () => {
  assert.equal(captionTextAt(captionTrack([]), 1), '');
  assert.equal(captionTextAt(null, 1), '');
  assert.equal(captionTextAt(captionTrack(null), 1), '');
  const track = captionTrack(parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nX\n'));
  assert.equal(captionTextAt(track, NaN), '');
  assert.equal(captionTextAt(track, undefined), '');
  assert.equal(captionTextAt(track, '1.5'), 'X');
});

t('a long file looks up in a few steps', () => {
  let vtt = 'WEBVTT\n\n';
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.000`;
  for (let s = 0; s < 7200; s += 2) vtt += `${stamp(s)} --> ${stamp(s + 1)}\nLine ${s}\n\n`;
  const track = captionTrack(parseVtt(vtt));
  assert.equal(track.cues.length, 3600);
  assert.equal(captionTextAt(track, 4000.5), 'Line 4000');
  assert.equal(captionTextAt(track, 4001.5), '');
  assert.equal(captionTextAt(track, 7198.2), 'Line 7198');
});

console.log(`\n${n} caption checks passed`);
