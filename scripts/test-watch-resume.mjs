// node scripts/test-watch-resume.mjs — where a title picks up when the
// app's player takes it back (mobile/src/lib/watchResume.js, used by
// mobile/src/lib/useWatchProgress.js): after the trailer, after Buy's
// fresh link, or the first time it plays.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// mobile/package.json has no "type": "module", so load the source as an
// explicit ES module (scripts/test-captions.mjs does the same).
const source = readFileSync(new URL('../mobile/src/lib/watchResume.js', import.meta.url), 'utf8');
const { restoreTarget, sameTitleItem, shouldSeek } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the file imports nothing (the test loads it on its own)', () => {
  assert.ok(!/^\s*import\s/m.test(source));
});

t('the visit’s own position wins over the server’s', () => {
  assert.equal(restoreTarget({ visitSeconds: 1200, startAt: 300 }), 1200);
  assert.equal(restoreTarget({ visitSeconds: 0, startAt: 300 }), 300);
  assert.equal(restoreTarget({ visitSeconds: 0, startAt: 0 }), 0);
  assert.equal(restoreTarget({}), 0);
  assert.equal(restoreTarget({ visitSeconds: -5, startAt: -1 }), 0);
});

t('a trailer still being swapped out is not the title', () => {
  // The title played this visit at 45 minutes; the trailer runs 90 s.
  assert.equal(sameTitleItem(2700, 90), false);
  assert.equal(sameTitleItem(2700, 2700.4), true);
  // A length not in yet: wait for it.
  assert.equal(sameTitleItem(2700, 0), false);
  // Never seen this visit: the first ready stream is the title.
  assert.equal(sameTitleItem(0, 90), true);
  assert.equal(sameTitleItem(null, 0), true);
});

t('seek only for a real jump', () => {
  assert.equal(shouldSeek({ target: 1200, currentTime: 0, duration: 2700 }), true);
  // Nowhere to go.
  assert.equal(shouldSeek({ target: 0, currentTime: 0, duration: 2700 }), false);
  // Inside the last five seconds: start over instead.
  assert.equal(shouldSeek({ target: 2696, currentTime: 0, duration: 2700 }), false);
  // A stall that came back ready a second later is not a resume.
  assert.equal(shouldSeek({ target: 1200, currentTime: 1198.5, duration: 2700 }), false);
  // Length unknown: go.
  assert.equal(shouldSeek({ target: 1200, currentTime: 0, duration: 0 }), true);
});

console.log(`${n} checks passed`);
