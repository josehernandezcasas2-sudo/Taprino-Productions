// node scripts/test-review-deck.mjs — the app's admin review deck's
// blocker line (mobile/src/lib/reviewDeckRules.js blockedLine): a show
// episode Approve can't take, and an application's Accept for a sub-admin
// (the queue's meta.canAccept / meta.acceptBlocker), which only a full
// admin may give since it grants Creator Studio.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// mobile/package.json has no "type": "module", so load the source as an
// explicit ES module (scripts/test-captions.mjs does the same).
const source = readFileSync(new URL('../mobile/src/lib/reviewDeckRules.js', import.meta.url), 'utf8');
const { blockedLine, metaRows } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the file imports nothing (the test loads it on its own)', () => {
  assert.ok(!/^\s*import\s/m.test(source));
});

t('a submission keeps its own blocker line', () => {
  assert.equal(blockedLine({ kind: 'submission', meta: { blocked: 'E3 is taken — use E5.' } }), 'E3 is taken — use E5.');
  assert.equal(blockedLine({ kind: 'submission', meta: {} }), null);
});

t('an application a sub-admin may not accept: greyed, with the server’s line', () => {
  const line = 'A full admin accepts an application, since that grants Creator Studio. You can hold it or decline it.';
  assert.equal(blockedLine({ kind: 'application', meta: { canAccept: false, acceptBlocker: line } }), line);
  // A server that says no without words still greys it.
  assert.equal(blockedLine({ kind: 'application', meta: { canAccept: false } }), 'A full admin accepts an application.');
});

t('a full admin, or a server from before canAccept: Accept stays on', () => {
  assert.equal(blockedLine({ kind: 'application', meta: { canAccept: true, acceptBlocker: null } }), null);
  assert.equal(blockedLine({ kind: 'application', meta: { masterReady: true } }), null);
  assert.equal(blockedLine({ kind: 'application' }), null);
  assert.equal(blockedLine(null), null);
});

t('the blocker line is not repeated as a meta row', () => {
  const rows = metaRows({ acceptBlocker: 'A full admin accepts an application.', canAccept: false, filesLink: 'https://example.com/f' });
  assert.deepEqual(rows.map((r) => r[0]), ['filesLink']);
});

console.log(`${n} checks passed`);
