// node scripts/test-resume-task.mjs — signing in or up in the middle of
// something keeps the person on the page and picks the thing back up
// (lib/resumeTaskRules.js, 2026-11-14). The app's copy is checked word
// for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/resumeTaskRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const NOW = Date.parse('2026-11-14T18:00:00Z');
const MIN = 60000;

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/resumeTaskRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/resumeTaskRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('either outcome of the sign-in box ends on the page the person was on', () => {
  assert.deepEqual(R.stayHereProps('/episode/night-bus-e1?autoplay=1'), { forceRedirectUrl: '/episode/night-bus-e1?autoplay=1', signUpForceRedirectUrl: '/episode/night-bus-e1?autoplay=1' });
  assert.deepEqual(R.stayHereSignUpProps('/pitches/abc#back'), { forceRedirectUrl: '/pitches/abc#back', signInForceRedirectUrl: '/pitches/abc#back' });
});

t('only a site path is ever handed to Clerk', () => {
  assert.equal(R.sitePath('/crew/calls/1'), '/crew/calls/1');
  assert.equal(R.sitePath('//evil.example'), '/');
  assert.equal(R.sitePath('/\\evil.example'), '/');
  assert.equal(R.sitePath('https://evil.example/x'), '/');
  assert.equal(R.sitePath('/a\nb'), '/');
  assert.equal(R.sitePath('/a\\b'), '/');
  assert.equal(R.sitePath(''), '/');
  assert.equal(R.sitePath(null), '/');
  assert.deepEqual(R.stayHereProps('//evil.example'), { forceRedirectUrl: '/', signUpForceRedirectUrl: '/' });
  assert.equal(R.pageOf('/episode/x?autoplay=1#notes'), '/episode/x');
  assert.equal(R.pageOf('/'), '/');
  assert.equal(R.pageOf('nope'), '/');
});

t('the tasks', () => {
  assert.equal(R.tipTask('user_1'), 'tip:user_1');
  assert.equal(R.buyTask('episode', 'night-bus-e1'), 'buy:episode:night-bus-e1');
  assert.deepEqual(R.buyParts('buy:series:night-bus'), { type: 'series', id: 'night-bus' });
  assert.deepEqual(R.buyParts('buy:episode:a:b'), { type: 'episode', id: 'a:b' });
  assert.equal(R.buyParts('tip:user_1'), null);
  assert.equal(R.buyParts('buy:episode:'), null);
  assert.equal(R.buyParts(null), null);
});

t('a mark is picked up on the same page, by the same task, for fifteen minutes', () => {
  const mark = R.taskMark('tip:user_1', '/episode/x?autoplay=1', NOW);
  assert.deepEqual(mark, { task: 'tip:user_1', path: '/episode/x', at: NOW });
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/x', now: NOW + 2 * MIN }), true);
  // The query and the hash may have changed on the way back.
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/x?tipped=1#top', now: NOW + 2 * MIN }), true);
  assert.equal(R.resumeDue(mark, { want: 'tip:user_2', path: '/episode/x', now: NOW + MIN }), false);
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/y', now: NOW + MIN }), false);
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/x', now: NOW + 15 * MIN }), true);
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/x', now: NOW + 15 * MIN + 1 }), false);
  // A clock that went backwards is not "fresh".
  assert.equal(R.resumeDue(mark, { want: 'tip:user_1', path: '/episode/x', now: NOW - 1 }), false);
});

t('a family of tasks: any buy on this page', () => {
  const mark = R.taskMark(R.buyTask('episode', 'e1'), '/series/night-bus', NOW);
  assert.equal(R.resumeDue(mark, { want: 'buy:', path: '/series/night-bus', now: NOW }), true);
  assert.equal(R.resumeDue(mark, { want: 'tip:', path: '/series/night-bus', now: NOW }), false);
  assert.equal(R.resumeDue(R.taskMark('buy:', '/series/night-bus', NOW), { want: 'buy:', path: '/series/night-bus', now: NOW }), false);
  assert.equal(R.resumeDue(R.taskMark('plans', '/episode/x', NOW), { want: 'plans', path: '/episode/x', now: NOW }), true);
});

t('nothing is picked up from a missing or broken mark', () => {
  assert.equal(R.markStale(null, NOW), true);
  assert.equal(R.markStale({}, NOW), true);
  assert.equal(R.markStale({ task: 'plans', path: '/x', at: 'soon' }, NOW), true);
  assert.equal(R.markStale({ task: '', path: '/x', at: NOW }, NOW), true);
  assert.equal(R.markStale({ task: 'plans', path: '/x', at: NOW }, NOW), false);
  assert.equal(R.resumeDue(null, { want: 'plans', path: '/x', now: NOW }), false);
  assert.equal(R.resumeDue({ task: 'plans', path: '/x', at: NOW }, { path: '/x', now: NOW }), false);
  assert.equal(R.resumeDue({ task: 'plans', path: '/x', at: NOW }), false);
});

console.log(`${n} passed`);
