// node scripts/test-submit-body.mjs — what the three-step submit sends
// for the files (lib/submitRules.js toSubmitBody): the master's uid and
// runtime, and a trailer only once Cloudflare has the whole file
// (processing or ready, the rule lib/showPage.js follows for a draft sent
// from the show page). A trailer still uploading, or one whose upload
// stopped, used to go with the title and attach a file that never arrived.
import assert from 'node:assert/strict';
import { EMPTY_SUBMIT_FORM, toSubmitBody } from '../lib/submitRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const form = { ...EMPTY_SUBMIT_FORM, contentType: 'movie', title: 'Night Bus', description: 'A ride.', artist: 'Mara', runtime: '12:04' };
const video = { uid: 'a'.repeat(32), state: 'uploading', runtimeSeconds: 724 };

t('the master goes with its runtime, whatever its state', () => {
  const body = toSubmitBody(form, { video });
  assert.equal(body.videoUid, video.uid);
  assert.equal(body.runtimeSeconds, 724);
});

t('a trailer Cloudflare has whole goes with it (processing or ready)', () => {
  for (const state of ['processing', 'ready']) {
    const body = toSubmitBody(form, { video, trailer: { uid: 'b'.repeat(32), state, name: 'clip.mp4' } });
    assert.equal(body.trailerUid, 'b'.repeat(32), state);
  }
});

t('a trailer still uploading, stopped, failed or without a uid stays out', () => {
  for (const trailer of [
    { uid: 'b'.repeat(32), state: 'uploading' },
    { uid: 'b'.repeat(32), state: 'stopped' },
    { uid: 'b'.repeat(32), state: 'error' },
    { uid: 'b'.repeat(32) },
    { state: 'ready' }
  ]) {
    assert.ok(!('trailerUid' in toSubmitBody(form, { video, trailer })), JSON.stringify(trailer));
  }
  assert.ok(!('trailerUid' in toSubmitBody(form, { video, trailer: null })));
  assert.ok(!('trailerUid' in toSubmitBody(form, {})));
});

console.log(`\n${n} submit-body checks passed`);
