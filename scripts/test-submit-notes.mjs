// node scripts/test-submit-notes.mjs — the notes for a title's own page on
// the three-step submit (lib/submitRules.js; Jose, 2026-11-12): the box
// is for a title that has its own page from the start (a film or a short,
// the same answer as lib/showRules.js episodeHasPage gives a new title of
// each type), the notes ride with the draft's form and go to the server
// trimmed, and only for those types. The app's copy
// (mobile/src/lib/submitRules.js) is checked to say the same.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_SUBMIT_FORM, SUBMIT_NOTES_MAX, SUBMIT_TYPES, submitHasOwnPage, toSubmitBody } from '../lib/submitRules.js';
import { episodeHasPage } from '../lib/showRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const form = (extra) => ({ ...EMPTY_SUBMIT_FORM, title: 'Night Bus', description: 'A ride.', artist: 'Mara', runtime: '12:04', ...extra });

t('the box is for a film or a short — what episodeHasPage says of a new title', () => {
  for (const { value } of SUBMIT_TYPES) {
    const show = ['series', 'podcast', 'bonus'].includes(value) ? 'night-bus-show' : null;
    assert.equal(submitHasOwnPage(value), episodeHasPage({ contentType: value, seriesId: show }), value);
  }
  assert.equal(submitHasOwnPage('movie'), true);
  assert.equal(submitHasOwnPage('short'), true);
  assert.equal(submitHasOwnPage('series'), false);
  assert.equal(submitHasOwnPage(undefined), false);
});

t('a new form starts with empty notes; the limit is 4,000', () => {
  assert.equal(EMPTY_SUBMIT_FORM.pageNotes, '');
  assert.equal(SUBMIT_NOTES_MAX, 4000);
});

t('the notes go to the server trimmed, for a film or a short only', () => {
  assert.equal(toSubmitBody(form({ contentType: 'movie', pageNotes: '  Shot in one night.\n\nOn a real bus.  ' }), {}).pageNotes, 'Shot in one night.\n\nOn a real bus.');
  assert.equal(toSubmitBody(form({ contentType: 'short', pageNotes: 'x' }), {}).pageNotes, 'x');
  for (const type of ['series', 'podcast', 'vertical', 'bonus']) {
    assert.ok(!('pageNotes' in toSubmitBody(form({ contentType: type, seriesId: 'night-bus-show', seriesOrder: '1', pageNotes: 'x' }), {})), type);
  }
  assert.ok(!('pageNotes' in toSubmitBody(form({ contentType: 'movie', pageNotes: '   ' }), {})), 'blank sends nothing');
  assert.ok(!('pageNotes' in toSubmitBody(form({ contentType: 'movie' }), {})), 'an old draft without the key');
});

t('the app’s copy says the same', () => {
  const app = readFileSync(new URL('../mobile/src/lib/submitRules.js', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../lib/submitRules.js', import.meta.url), 'utf8');
  const fn = (src) => /export function submitHasOwnPage[\s\S]*?\n}\n/.exec(src)[0];
  assert.equal(fn(app), fn(web));
  assert.match(app, /export const SUBMIT_NOTES_MAX = 4000;/);
  assert.match(app, /pageNotes: '',/);
  const bodyLine = /\.\.\.\(submitHasOwnPage\(f\.contentType\)[^\n]*/;
  assert.equal(bodyLine.exec(app)[0], bodyLine.exec(web)[0]);
});

console.log(`\n${n} submit-notes checks passed`);
