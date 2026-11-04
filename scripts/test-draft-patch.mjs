// node scripts/test-draft-patch.mjs — partial saves of a Creator Studio
// draft (lib/draftPatch.js) and the app's copy (mobile/src/lib/draftPatch.js):
// the copy is checked word for word, then every case runs on both. The
// guarded merge itself (lib/creatorDrafts.js patchDraft) is played here on
// an in-memory row the way the server runs it — read, merge, write only
// while updated_at is the one read — with two writers interleaved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/draftPatch.js';

const webSource = readFileSync(new URL('../lib/draftPatch.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/draftPatch.js', import.meta.url), 'utf8');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');
t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const DRAFT_ID'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/draftPatch.js imports nothing');
});

for (const [label, m] of [['web', web], ['app', app]]) {
  t(`${label}: a draft id is a uuid`, () => {
    assert.equal(m.isDraftId('3f1c2a9e-0b7d-4c55-9a1e-2b3c4d5e6f70'), true);
    assert.equal(m.isDraftId('3F1C2A9E-0B7D-4C55-9A1E-2B3C4D5E6F70'), true);
    for (const bad of ['', null, undefined, 'night-bus-lx3k9a', '3f1c2a9e0b7d4c559a1e2b3c4d5e6f70', '3f1c2a9e-0b7d-4c55-9a1e-2b3c4d5e6f70x', "x' or 1=1"]) assert.equal(m.isDraftId(bad), false, String(bad));
  });

  t(`${label}: changedFields sends only what differs`, () => {
    const was = { title: 'Pilot', season: '1', seriesOrder: '3', adsEnabled: true, tier: 'free', runtime: '' };
    assert.deepEqual(m.changedFields(was, { ...was }), {});
    assert.deepEqual(m.changedFields(was, { ...was, title: 'Pilot!' }), { title: 'Pilot!' });
    assert.deepEqual(m.changedFields(was, { ...was, adsEnabled: false, runtime: '22:00' }), { adsEnabled: false, runtime: '22:00' });
    // A key the screen holds that the server never had counts as changed
    // only when it is not empty-equal: undefined and a missing key are the same.
    assert.deepEqual(m.changedFields({}, { a: undefined }), {});
    assert.deepEqual(m.changedFields({}, { a: null }), {});
    assert.deepEqual(m.changedFields({}, { a: '' }), { a: '' });
    assert.deepEqual(m.changedFields(null, { step: 2 }), { step: 2 });
    // Numbers and strings are not the same value.
    assert.deepEqual(m.changedFields({ step: '2' }, { step: 2 }), { step: 2 });
    // Nested values compare by JSON.
    assert.deepEqual(m.changedFields({ x: { a: 1 } }, { x: { a: 1 } }), {});
    assert.deepEqual(m.changedFields({ x: { a: 1 } }, { x: { a: 2 } }), { x: { a: 2 } });
  });

  t(`${label}: mediaChanged`, () => {
    const v = { uid: 'abc', state: 'uploading', name: 'e1.mp4', bytes: 10, uploadUrl: null, runtimeSeconds: null };
    assert.equal(m.mediaChanged(v, { ...v }), false);
    assert.equal(m.mediaChanged(null, null), false);
    assert.equal(m.mediaChanged(undefined, null), false);
    assert.equal(m.mediaChanged(v, { ...v, state: 'processing' }), true);
    assert.equal(m.mediaChanged(v, null), true);
    assert.equal(m.mediaChanged(null, v), true);
  });

  t(`${label}: mergeForm keeps every key not sent`, () => {
    const stored = { title: 'Old', seriesId: 'night-bus', season: '1', seriesOrder: '2', step: 2 };
    assert.deepEqual(m.mergeForm(stored, { title: 'New' }), { title: 'New', seriesId: 'night-bus', season: '1', seriesOrder: '2', step: 2 });
    assert.deepEqual(m.mergeForm(stored, {}), stored);
    assert.deepEqual(m.mergeForm(stored, undefined), stored);
    assert.deepEqual(m.mergeForm(null, { title: 'A' }), { title: 'A' });
    assert.deepEqual(m.mergeForm([], { title: 'A' }), { title: 'A' });
    assert.deepEqual(m.mergeForm(stored, ['x']), stored);
    // null replaces the key's value (the screen held null), undefined doesn't.
    assert.deepEqual(m.mergeForm({ audioUrl: 'https://a' }, { audioUrl: null }), { audioUrl: null });
    assert.deepEqual(m.mergeForm({ audioUrl: 'https://a' }, { audioUrl: undefined }), { audioUrl: 'https://a' });
    // The stored form is never changed in place.
    const before = JSON.stringify(stored);
    m.mergeForm(stored, { title: 'X' });
    assert.equal(JSON.stringify(stored), before);
  });

  t(`${label}: mergeForm drops prototype keys`, () => {
    const change = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "prototype": 2, "title": "T"}');
    const out = m.mergeForm({}, change);
    assert.deepEqual(Object.keys(out), ['title']);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
  });

  t(`${label}: nextStamp is now, and always after the stamp read`, () => {
    const now = Date.parse('2026-11-04T20:00:00.000Z');
    assert.equal(m.nextStamp('2026-11-04T19:00:00.000Z', now), '2026-11-04T20:00:00.000Z');
    // The stamp read is the same millisecond (or ahead of this clock): one later.
    assert.equal(m.nextStamp('2026-11-04T20:00:00.000Z', now), '2026-11-04T20:00:00.001Z');
    assert.equal(m.nextStamp('2026-11-04T20:00:05.000Z', now), '2026-11-04T20:00:05.001Z');
    // PostgREST's own format (microseconds, +00:00).
    assert.equal(m.nextStamp('2026-11-04T20:00:00.000412+00:00', now), '2026-11-04T20:00:00.001Z');
    assert.equal(m.nextStamp(null, now), '2026-11-04T20:00:00.000Z');
    assert.equal(m.nextStamp('not a date', now), '2026-11-04T20:00:00.000Z');
  });
}

// --- the guarded merge, played on a row in memory ----------------------------------
// One row; a "save" reads it, works out the columns, and writes only while
// updated_at is still the one it read (patchDraft's loop, with the same
// pure pieces). The steps are run by hand to interleave two writers.
function makeStore(row) {
  let clock = Date.parse('2026-11-04T20:00:00.000Z');
  return {
    row,
    read() { return JSON.parse(JSON.stringify(this.row)); },
    write(cols, guard) {
      if (this.row.updated_at !== guard) return false;
      this.row = { ...this.row, ...cols };
      return true;
    },
    tick() { clock += 1; return clock; },
    now() { return clock; }
  };
}
function plan(store, before, change) {
  const cols = {};
  if (change.form) cols.form = web.mergeForm(before.form, change.form);
  if ('video' in change) Object.assign(cols, change.video ? { video_uid: change.video.uid, video_state: change.video.state, upload_url: change.video.uploadUrl || null } : { video_uid: null, video_state: null, upload_url: null });
  cols.updated_at = web.nextStamp(before.updated_at, store.now());
  return cols;
}
function save(store, change, { tries = 4 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const before = store.read();
    if (store.write(plan(store, before, change), before.updated_at)) return true;
  }
  return false;
}
const fresh = () => makeStore({ id: 'd1', form: { title: '', seriesId: 'night-bus', season: '1', seriesOrder: '4', step: 2 }, video_uid: null, video_state: null, upload_url: null, updated_at: '2026-11-04T19:59:00.000Z' });
const queueWrite = { video: { uid: 'vid-1', state: 'uploading', uploadUrl: 'https://upload.example/tus/1' } };
const editorWrite = { form: { title: 'The night shift', season: '1', seriesOrder: '4' } };

t('interleaved: the queue reads, the editor saves, then the queue writes — nothing lost', () => {
  const store = fresh();
  const qBefore = store.read();
  const qCols = plan(store, qBefore, queueWrite);
  store.tick();
  assert.equal(save(store, editorWrite), true);
  // The queue's write was planned on the old row: the guard refuses it…
  assert.equal(store.write(qCols, qBefore.updated_at), false);
  // …and the queue reads again and merges again.
  store.tick();
  assert.equal(save(store, queueWrite), true);
  assert.equal(store.row.form.title, 'The night shift');
  assert.equal(store.row.video_uid, 'vid-1');
  assert.equal(store.row.upload_url, 'https://upload.example/tus/1');
});

t('interleaved: the editor reads, the queue saves, then the editor writes — nothing lost', () => {
  const store = fresh();
  const eBefore = store.read();
  const eCols = plan(store, eBefore, editorWrite);
  store.tick();
  assert.equal(save(store, queueWrite), true);
  assert.equal(store.write(eCols, eBefore.updated_at), false);
  store.tick();
  assert.equal(save(store, editorWrite), true);
  assert.equal(store.row.form.title, 'The night shift');
  assert.equal(store.row.video_uid, 'vid-1');
});

t('same millisecond: the second stamp is still a new one', () => {
  const store = fresh();
  const a = store.read();
  const b = store.read();
  // Both plan at the same clock: a lands, b's guard fails although its
  // stamp would be the same instant as a's.
  assert.equal(store.write(plan(store, a, editorWrite), a.updated_at), true);
  assert.equal(store.write(plan(store, b, queueWrite), b.updated_at), false);
  assert.equal(save(store, queueWrite), true);
  assert.notEqual(store.row.updated_at, a.updated_at);
  assert.equal(store.row.form.title, 'The night shift');
  assert.equal(store.row.video_uid, 'vid-1');
});

t('a form-only save never touches the video, a video-only save never the form', () => {
  const store = fresh();
  save(store, queueWrite);
  save(store, { form: { title: 'A' } });
  assert.equal(store.row.video_uid, 'vid-1');
  save(store, { video: { uid: 'vid-1', state: 'processing' } });
  assert.equal(store.row.form.title, 'A');
  assert.equal(store.row.video_state, 'processing');
  assert.equal(store.row.form.seriesOrder, '4');
});

console.log(`\n${n} checks passed`);
