// node scripts/test-download-logic.mjs — downloads in the app, what the
// phone itself decides (mobile/src/lib/downloadLogic.js, 2026-11-14) on top
// of the shared rules (mobile/src/lib/downloadRules.js): what the index
// keeps, what a check-in changes, whether a copy may play, and what the
// Downloads page says about each row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// mobile/package.json has no "type": "module": load the sources as explicit
// ES modules (scripts/test-captions.mjs).
const load = async (path) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return { source, mod: await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) };
};
const { mod: rules } = await load('../mobile/src/lib/downloadRules.js');
const { source, mod: lib } = await load('../mobile/src/lib/downloadLogic.js');
const logic = lib.createDownloadLogic(rules);
const W = rules.DOWNLOAD_WORDS;

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 14, 18, 0, 0); // Nov 14, 2026
const at = (days) => NOW + days * DAY;
const item = (fields = {}) => ({
  episodeId: 'night-bus-e2', title: 'Last Stop', kicker: 'Night Bus · Season 1 · Episode 2', seriesId: 'night-bus-ab12', seriesName: 'Night Bus', season: 1, number: 2,
  contentType: 'series', runtimeSeconds: 1320, rating: 'TV-14', basis: 'member', licensedUntil: at(12), endedAt: null, keepUntil: null,
  state: 'ready', progress: 1, bytes: 310 * 1024 * 1024, file: 'night-bus-e2.mp4', resumeSeconds: 0, addedAt: 1, licensed: true, userPaused: false, wait: null, error: null,
  ...fields
});
const indexOf = (items, fields = {}) => ({ ...lib.emptyIndex(), userId: 'user_a', lastSeenAt: NOW, paidThrough: at(10), items: Object.fromEntries(items.map((i) => [i.episodeId, i])), ...fields });
const rowsOf = (index, now = NOW, missing = {}) => logic.sortedItems(index).map((i) => ({ item: i, status: logic.rowStatus(index, i, { now, missing: missing[i.episodeId] === true }) }));

t('the file imports nothing (the test loads it on its own)', () => {
  assert.ok(!/^\s*import\s/m.test(source));
});

t('a title id is what makes a safe file name', () => {
  assert.equal(lib.isTitleSlug('night-bus-last-stop-lx3k9a'), true);
  assert.equal(lib.isTitleSlug('-old_id'), true);
  for (const bad of ['', '../x', 'a/b', 'a.b', 'a b', null, 12, 'x'.repeat(201)]) assert.equal(lib.isTitleSlug(bad), false);
});

t('the index as read: anything malformed is dropped, a transfer left in flight goes back in line', () => {
  assert.deepEqual(lib.normalizeIndex(null), lib.emptyIndex());
  assert.deepEqual(lib.normalizeIndex('nonsense'), lib.emptyIndex());
  assert.deepEqual(lib.normalizeIndex([]), lib.emptyIndex());
  const out = lib.normalizeIndex({
    userId: 'user_a', deviceId: 'dev', deviceKnown: true, lastSeenAt: '2026-11-14T18:00:00.000Z', paidThrough: at(10), wifiOnly: false, plan: { carries: true, tier: 'premium' }, enabled: true,
    items: {
      a: { episodeId: 'a', state: 'downloading', progress: 0.4, userPaused: true, wait: 'wifi', licensedUntil: new Date(at(12)).toISOString() },
      b: { episodeId: 'b', state: 'preparing' },
      c: { episodeId: 'c', state: 'ready', progress: 7, resumeSeconds: -4 },
      d: { episodeId: 'other', state: 'ready' },
      '../e': { episodeId: '../e', state: 'ready' },
      f: 'text',
      g: { episodeId: 'g', state: 'made-up' }
    },
    notices: [{ reason: 'title', at: NOW, episodeId: 'x', title: 'X' }, { reason: 'title' }, 'no', { at: NOW }]
  });
  assert.equal(out.lastSeenAt, NOW);
  assert.equal(out.wifiOnly, false);
  assert.deepEqual(Object.keys(out.items).sort(), ['a', 'b', 'c', 'g']);
  assert.deepEqual([out.items.a.state, out.items.a.userPaused, out.items.a.wait, out.items.a.licensedUntil], ['paused', false, null, at(12)]);
  assert.equal(out.items.b.state, 'queued');
  assert.deepEqual([out.items.c.progress, out.items.c.resumeSeconds], [1, 0]);
  assert.equal(out.items.g.state, 'failed');
  assert.equal(out.notices.length, 1);
  // Wi-Fi only is on unless it was switched off.
  assert.equal(lib.normalizeIndex({}).wifiOnly, true);
});

t('what is kept of a title, and its labels', () => {
  assert.deepEqual(lib.pickMeta({ title: 'T', art: 'http://x', url: 'http://secret', rating: 'PG', nonsense: 1, hasFlashingLights: true }), { title: 'T', rating: 'PG', hasFlashingLights: true });
  assert.deepEqual(lib.pickMeta(null), {});
  assert.equal(lib.clockLabel(2470), '41:10');
  assert.equal(lib.clockLabel(3723), '1:02:03');
  assert.equal(lib.clockLabel(-5), '0:00');
  assert.equal(lib.runtimeLabel(1320), '22 min');
  assert.equal(lib.runtimeLabel(5460), '1 h 31 min');
  assert.equal(lib.runtimeLabel(7200), '2 h');
  assert.equal(lib.runtimeLabel(20), '1 min');
  assert.equal(lib.runtimeLabel(0), '');
  assert.equal(lib.episodeCodeOf(item()), 'S1 E2');
  assert.equal(lib.episodeCodeOf(item({ seriesId: null })), '');
  assert.equal(lib.kindLabel({ contentType: 'movie' }), 'Film');
  assert.equal(lib.kindLabel({ contentType: 'short' }), 'Short');
  assert.equal(lib.kindLabel({}), 'Title');
});

t('may it play: not here, not finished, then the shared rule', () => {
  const index = indexOf([item()]);
  assert.deepEqual(logic.itemPlayState(index, null), { ok: false, reason: 'nothere' });
  assert.deepEqual(logic.itemPlayState(index, item({ state: 'downloading' }), { now: NOW }), { ok: false, reason: 'notready' });
  assert.deepEqual(logic.itemPlayState(index, item(), { now: NOW }), { ok: true });
  assert.deepEqual(logic.itemPlayState(index, item(), { now: at(12) + 1 }), { ok: false, reason: 'expired' });
  assert.deepEqual(logic.itemPlayState(index, item(), { now: NOW - rules.CLOCK_SLACK_MS - 1 }), { ok: false, reason: 'clock' });
  assert.deepEqual(logic.itemPlayState(index, item({ endedAt: NOW }), { now: NOW }), { ok: false, reason: 'ended' });
  assert.deepEqual(logic.itemPlayState(index, item({ endedAt: NOW }), { now: NOW, missing: true }), { ok: false, reason: 'missing' });
  // No licensed date at all (never answered by the server) never plays.
  assert.deepEqual(logic.itemPlayState(index, item({ licensedUntil: null }), { now: NOW }), { ok: false, reason: 'expired' });
});

t('a check-in names only the copies the server has a row for', () => {
  const index = indexOf([item(), item({ episodeId: 'b', licensed: false, state: 'preparing' }), item({ episodeId: 'c', state: 'paused' })]);
  assert.deepEqual(logic.haveIds(index).sort(), ['c', 'night-bus-e2']);
  const many = indexOf(Array.from({ length: 70 }, (_, i) => item({ episodeId: `t${i}` })));
  assert.equal(logic.haveIds(many).length, lib.MAX_HAVE);
});

t('a check-in: ok renews, paused leaves it, ended keeps the file, revoked removes it', () => {
  const index = indexOf([
    item({ episodeId: 'ok1', licensedUntil: at(1), endedAt: at(-1), keepUntil: at(29) }),
    item({ episodeId: 'paused1', licensedUntil: at(1) }),
    item({ episodeId: 'ended1' }),
    item({ episodeId: 'gone1', title: 'Gone' }),
    item({ episodeId: 'refund1', basis: 'owned' }),
    item({ episodeId: 'norow', licensed: false, state: 'preparing' }),
    item({ episodeId: 'lost1' }),
    item({ episodeId: 'untouched' })
  ], { lastSeenAt: at(40), deviceKnown: false });
  const frozen = JSON.stringify(index);
  const res = {
    enabled: true, serverTime: new Date(NOW).toISOString(), paidThrough: new Date(at(40)).toISOString(), plan: { carries: true, tier: 'sponsor' }, limits: { titles: 25, devices: 2 }, deviceRemoved: false,
    items: [
      { episodeId: 'ok1', state: 'ok', basis: 'member', licensedUntil: new Date(at(33)).toISOString(), endedAt: null, keepUntil: null },
      { episodeId: 'paused1', state: 'paused', licensedUntil: new Date(at(1)).toISOString() },
      { episodeId: 'ended1', state: 'ended', endedAt: new Date(at(-2)).toISOString(), keepUntil: new Date(at(28)).toISOString() },
      { episodeId: 'gone1', state: 'revoked', reason: 'title' },
      { episodeId: 'refund1', state: 'revoked', reason: 'refund' },
      { episodeId: 'norow', state: 'revoked', reason: 'removed' },
      { episodeId: 'lost1', state: 'revoked', reason: 'removed' },
      { episodeId: 'never-heard-of', state: 'revoked', reason: 'title' },
      null
    ]
  };
  const out = logic.applySync(index, res, { now: NOW });
  assert.equal(JSON.stringify(index), frozen, 'the index handed in is not changed');
  const i = out.index.items;
  assert.deepEqual([i.ok1.licensedUntil, i.ok1.endedAt, i.ok1.keepUntil], [at(33), null, null]);
  assert.equal(i.paused1.licensedUntil, at(1));
  assert.deepEqual([i.ended1.endedAt, i.ended1.keepUntil, i.ended1.state], [at(-2), at(28), 'ready']);
  assert.ok(!i.gone1 && !i.refund1 && !i.lost1);
  assert.ok(i.norow, 'a download with no licence yet is not taken back for having no row');
  assert.ok(i.untouched);
  assert.deepEqual(out.remove.sort(), ['gone1', 'lost1', 'refund1']);
  assert.equal(out.wipe, false);
  assert.deepEqual(out.index.notices.map((x) => [x.episodeId, x.reason, x.title]), [['gone1', 'title', 'Gone'], ['refund1', 'refund', 'Last Stop'], ['lost1', 'removed', 'Last Stop']]);
  assert.equal(out.index.paidThrough, at(40));
  assert.deepEqual(out.index.plan, { carries: true, tier: 'sponsor' });
  assert.equal(out.index.lastSyncAt, NOW);
  assert.equal(out.index.lastSeenAt, NOW, 'a check-in the server answered re-bases the mark (a clock that had run ahead)');
  assert.equal(out.index.deviceKnown, true);
  // 'ended' with no dates from the server: now, and the shared rule's 30 days.
  const e = logic.applySync(indexOf([item()]), { items: [{ episodeId: 'night-bus-e2', state: 'ended' }] }, { now: NOW }).index.items['night-bus-e2'];
  assert.deepEqual([e.endedAt, e.keepUntil], [NOW, NOW + rules.KEEP_AFTER_END_DAYS * DAY]);
  // A team account: paidThrough null is kept as null.
  assert.equal(logic.applySync(index, { items: [], paidThrough: null }, { now: NOW }).index.paidThrough, null);
});

t('a check-in: this phone was removed elsewhere — everything goes', () => {
  const index = indexOf([item(), item({ episodeId: 'b' })], { deviceKnown: true });
  const out = logic.applySync(index, { deviceRemoved: true, items: [{ episodeId: 'night-bus-e2', state: 'revoked', reason: 'device' }] }, { now: NOW });
  assert.deepEqual(out.index.items, {});
  assert.equal(out.wipe, true);
  assert.equal(out.index.deviceKnown, false);
  assert.deepEqual(out.index.notices.map((x) => x.reason), ['device']);
  assert.equal(logic.noticeCard(out.index.notices[0]).title, lib.APP_WORDS.deviceRemovedTitle);
});

t('an answer that isn’t the server’s changes nothing', () => {
  const index = indexOf([item()]);
  for (const res of [null, undefined, 'x', {}, { items: 'no' }, { error: 'Something went wrong' }]) {
    const out = logic.applySync(index, res, { now: at(5) });
    assert.equal(out.index, index);
    assert.deepEqual(out.remove, []);
  }
});

t('kept files whose time is up go; old notes too', () => {
  const index = indexOf([item({ episodeId: 'a', endedAt: at(-31), keepUntil: at(-1) }), item({ episodeId: 'b', endedAt: at(-10), keepUntil: at(20) }), item({ episodeId: 'c' })], {
    notices: [{ episodeId: 'x', title: null, reason: 'title', at: NOW - lib.NOTICE_KEEP_MS - 1 }, { episodeId: 'y', title: null, reason: 'title', at: NOW }]
  });
  const due = logic.dueRemovals(index, NOW);
  assert.deepEqual(due.ids, ['a']);
  assert.deepEqual(due.notices.map((x) => x.episodeId), ['y']);
  assert.equal(due.changed, true);
  assert.equal(logic.dueRemovals(indexOf([item()]), NOW).changed, false);
});

t('the rows: each state and what it says (the mockup’s lines)', () => {
  const index = indexOf([item()]);
  const say = (fields, opts = {}, ctx = {}) => {
    const it = item(fields);
    const status = logic.rowStatus(index, it, { now: NOW, ...ctx });
    return { status, ...logic.rowText(it, status, opts) };
  };
  let r = say({});
  assert.deepEqual([r.status.kind, r.sub, r.note], ['play', 'Night Bus S1 E2 · 310 MB', '']);
  r = say({}, { offline: true });
  assert.equal(r.sub, 'Night Bus S1 E2 · 22 min');
  r = say({ contentType: 'movie', seriesId: null, seriesName: null, number: null, runtimeSeconds: 5460, bytes: 1.1 * 1024 * 1024 * 1024, resumeSeconds: 2470 });
  assert.deepEqual([r.sub, r.note], ['Film · 1 h 31 min · 1.1 GB', 'Resume at 41:10']);
  r = say({ contentType: 'short', seriesId: null, seriesName: null, number: null, runtimeSeconds: 720, bytes: 160 * 1024 * 1024, basis: 'owned' });
  assert.deepEqual([r.sub, r.note], ['Short · 12 min · 160 MB', W.owned]);
  r = say({ basis: 'owned' }, { lockShown: true });
  assert.equal(r.note, 'Yours to keep · still plays');
  r = say({ state: 'downloading', progress: 0.42, bytes: 340 * 1024 * 1024 });
  assert.deepEqual([r.status.kind, r.status.percent, r.sub, r.note], ['downloading', 42, 'Night Bus S1 E2 · 22 min', 'Downloading · 42% of 340 MB']);
  r = say({ state: 'downloading', progress: 0, bytes: null });
  assert.equal(r.note, 'Downloading · 0%');
  r = say({ state: 'paused', progress: 0.42, wait: 'offline' }, { offline: true });
  assert.deepEqual([r.status.kind, r.status.reason, r.note], ['paused', 'offline', 'Paused at 42% · finishes when you’re back online']);
  r = say({ state: 'paused', progress: 0.42, userPaused: true });
  assert.deepEqual([r.status.reason, r.note], ['user', 'Paused at 42%']);
  r = say({ state: 'paused', progress: 0.1, wait: 'wifi' });
  assert.deepEqual([r.status.kind, r.note], ['waiting', W.waitingWifi]);
  r = say({ state: 'queued', wait: 'wifi' });
  assert.deepEqual([r.status.kind, r.note], ['waiting', W.waitingWifi]);
  r = say({ state: 'queued' });
  assert.deepEqual([r.status.kind, r.note], ['queued', lib.APP_WORDS.queued]);
  // How the phone is connected right now says why a download isn't moving,
  // even when nothing has been written on it (the app opened offline).
  r = say({ state: 'paused', progress: 0.42 }, { offline: true }, { offline: true });
  assert.deepEqual([r.status.reason, r.note], ['offline', 'Paused at 42% · finishes when you’re back online']);
  r = say({ state: 'queued' }, {}, { wifiBlocked: true });
  assert.deepEqual([r.status.kind, r.note], ['waiting', W.waitingWifi]);
  r = say({ state: 'paused', progress: 0.42 }, {}, { offline: true, wifiBlocked: true });
  assert.equal(r.status.reason, 'offline');
  // The member's own pause, and a membership that ended, say only that.
  r = say({ state: 'paused', progress: 0.42, userPaused: true }, {}, { offline: true });
  assert.deepEqual([r.status.reason, r.note], ['user', 'Paused at 42%']);
  r = say({ state: 'paused', progress: 0.42, endedAt: at(-1) }, {}, { offline: true });
  assert.deepEqual([r.status.reason, r.note], ['auto', 'Paused at 42%']);
  r = say({ state: 'paused', progress: 0.42 });
  assert.deepEqual([r.status.reason, r.note], ['auto', 'Paused at 42%']);
  r = say({ state: 'preparing' });
  assert.deepEqual([r.status.kind, r.note], ['preparing', W.preparing]);
  r = say({ state: 'failed' });
  assert.deepEqual([r.status.kind, r.note, r.tone], ['failed', W.failed, 'danger']);
  r = say({ state: 'failed', error: 'Its maker switched downloads off for this title.' });
  assert.equal(r.note, 'Its maker switched downloads off for this title.');
  r = say({}, {}, { missing: true });
  assert.deepEqual([r.status.kind, r.note], ['missing', 'This download is gone']);
  r = say({ licensedUntil: at(-1) });
  assert.deepEqual([r.status.kind, r.status.reason, r.note], ['locked', 'expired', '']);
  r = say({ endedAt: at(-1) });
  assert.deepEqual([r.status.kind, r.status.reason], ['locked', 'ended']);
});

t('the summary, the chip and the small print: the end of the paid month, not the cushion after it', () => {
  // A monthly member: paid through Nov 24, licensed to Nov 26.
  let index = indexOf([item(), item({ episodeId: 'b', bytes: 1.6 * 1024 * 1024 * 1024, addedAt: 2 }), item({ episodeId: 'c', state: 'downloading', progress: 0.5, bytes: 200 * 1024 * 1024, addedAt: 3 })]);
  let rows = rowsOf(index);
  let sum = logic.summary(index, rows, { now: NOW });
  assert.equal(sum.line, '3 titles · 2 GB on this phone');
  assert.equal(sum.chip, 'Plays offline until Nov 24');
  assert.equal(logic.finePrint(index, rows, { now: NOW }), 'Downloads stay on this phone and play without a connection until Nov 24, the day your month is up. Open the app online around then and they carry on.');
  sum = logic.summary(index, rows, { offline: true, now: NOW });
  assert.deepEqual([sum.line, sum.chip], ['2 titles ready', 'Until Nov 24']);
  // In the two days after the month: the licensed date itself.
  rows = rowsOf(index, at(11));
  assert.equal(logic.summary(index, rows, { now: at(11) }).chip, 'Plays offline until Nov 26');
  assert.match(logic.finePrint(index, rows, { now: at(11) }), /until Nov 26\. Open the app online before then/);
  // An annual plan: never more than a month ahead.
  index = indexOf([item({ licensedUntil: at(33) })], { paidThrough: at(300) });
  assert.equal(logic.summary(index, rowsOf(index), { now: NOW }).chip, 'Plays offline until Dec 17');
  // The team (no paid-through date) and a bought title: the 30-day check-in.
  index = indexOf([item({ basis: 'owned', licensedUntil: at(30) })], { paidThrough: null });
  assert.equal(logic.summary(index, rowsOf(index), { now: NOW }).chip, 'Plays offline until Dec 14');
  // Only a bought title plays: the member's month isn't its date.
  index = indexOf([item({ basis: 'owned', licensedUntil: at(30) }), item({ episodeId: 'b', licensedUntil: at(-1) })]);
  assert.equal(logic.summary(index, rowsOf(index), { now: NOW }).chip, 'Plays offline until Dec 14');
  // One title, nothing playable, nothing at all.
  index = indexOf([item({ bytes: null })]);
  assert.equal(logic.summary(index, rowsOf(index), { now: NOW }).line, '1 title');
  index = indexOf([item({ licensedUntil: at(-1) })]);
  assert.deepEqual([logic.summary(index, rowsOf(index), { now: NOW }).chip, logic.finePrint(index, rowsOf(index), { now: NOW })], ['', '']);
  assert.equal(logic.summary(lib.emptyIndex(), [], { offline: true, now: NOW }).line, '0 titles ready');
});

t('the card over the list: the membership’s end first, then the clock, then the date', () => {
  // Month over, still offline: a member's copies lock, a bought title plays.
  let index = indexOf([item(), item({ episodeId: 'film', addedAt: 2 }), item({ episodeId: 'mine', basis: 'owned', licensedUntil: at(40), addedAt: 3 })], { paidThrough: at(10) });
  let now = at(13);
  let lock = logic.pageLock(index, rowsOf(index, now), { now });
  assert.equal(lock.reason, 'expired');
  assert.equal(lock.title, 'Connect to keep watching');
  assert.equal(lock.body, 'Your month ended on Nov 24 and this phone hasn’t been online since. Connect once and your downloads unlock. Nothing was deleted.');
  assert.equal(lock.action, 'retry');
  assert.deepEqual(lock.ids, ['night-bus-e2', 'film']);
  // Only a bought title ran out: thirty days, not "your month".
  index = indexOf([item({ basis: 'owned', licensedUntil: at(30) })]);
  now = at(31);
  lock = logic.pageLock(index, rowsOf(index, now), { now });
  assert.match(lock.body, /^This phone hasn’t been online for 30 days\./);
  // The team's copy (no paid-through date): the same.
  index = indexOf([item({ licensedUntil: at(30) })], { paidThrough: null });
  assert.match(logic.pageLock(index, rowsOf(index, now), { now }).body, /^This phone hasn’t been online for 30 days\./);
  // Membership ended (the server said so): its date, See plans.
  index = indexOf([item({ endedAt: at(-1), keepUntil: at(29) }), item({ episodeId: 'b', licensedUntil: at(-5), addedAt: 2 })]);
  lock = logic.pageLock(index, rowsOf(index), { now: NOW });
  assert.deepEqual([lock.reason, lock.title, lock.action], ['ended', 'Your membership ended on Nov 13', 'plans']);
  assert.deepEqual(lock.ids, ['night-bus-e2']);
  // The clock is behind.
  index = indexOf([item()], { lastSeenAt: at(3) });
  lock = logic.pageLock(index, rowsOf(index), { now: NOW });
  assert.deepEqual([lock.reason, lock.action], ['clock', 'retry']);
  // Everything plays, a file is gone, something still downloads: no card.
  index = indexOf([item(), item({ episodeId: 'b', state: 'downloading', addedAt: 2 }), item({ episodeId: 'c', addedAt: 3 })]);
  assert.equal(logic.pageLock(index, rowsOf(index, NOW, { c: true }), { now: NOW }), null);
});

t('one copy’s lock (the offline player)', () => {
  const index = indexOf([item()], { paidThrough: at(-3) });
  assert.match(logic.itemLock(index, item(), 'expired', { now: NOW }).body, /^Your month ended on Nov 11/);
  // The admin switch was off at the last check-in: connecting won't unlock it, and the card says so.
  const off = logic.itemLock({ ...index, enabled: false }, item(), 'expired', { now: NOW });
  assert.equal(off.title, rules.DOWNLOAD_WORDS.off);
  assert.equal(off.body, lib.APP_WORDS.offBody);
  assert.equal(off.action, 'retry');
  assert.match(logic.itemLock(index, item({ basis: 'owned' }), 'expired', { now: NOW }).body, /^This phone hasn’t been online for 30 days/);
  assert.equal(logic.itemLock(index, item({ endedAt: at(-1) }), 'ended', { now: NOW }).action, 'plans');
  assert.deepEqual(logic.itemLock(index, item(), 'missing', { now: NOW }), { reason: 'missing', ...rules.lockCard('missing') });
  assert.equal(logic.itemLock(index, item(), 'clock', { now: NOW }).action, 'retry');
  assert.equal(logic.itemLock(index, null, 'nothere').title, lib.APP_WORDS.notHere);
  assert.equal(logic.itemLock(index, item({ state: 'paused' }), 'notready').title, lib.APP_WORDS.notReady);
});

t('the notes about copies the server took back', () => {
  assert.deepEqual(logic.noticeCard({ reason: 'title', title: 'Last Stop', at: NOW }), { title: 'No longer available: “Last Stop”', body: rules.lockCard('revoked').body });
  assert.equal(logic.noticeCard({ reason: 'title', title: null, at: NOW }).title, 'No longer available');
  assert.equal(logic.noticeCard({ reason: 'refund', title: 'Paper Moons', at: NOW }).body, lib.APP_WORDS.refundBody);
  assert.equal(logic.noticeCard({ reason: 'removed', title: 'X', at: NOW }).title, 'Removed from this phone: “X”');
  assert.equal(logic.noticeCard(null), null);
});

t('what the Download button says when the server says no, by its code', () => {
  const say = (r) => logic.refusal(r);
  assert.deepEqual(say({ status: 403, code: 'plan' }), { kind: 'plan', title: W.planTitle, body: W.planBody });
  assert.equal(say({ status: 409, code: 'titles' }).body, W.titleLimit);
  const dev = say({ status: 409, code: 'devices', devices: [{ deviceId: 'a' }] });
  assert.deepEqual([dev.kind, dev.body, dev.devices.length], ['devices', W.deviceLimit, 1]);
  assert.deepEqual(say({ status: 409, code: 'devices' }).devices, []);
  assert.equal(say({ status: 403, code: 'off' }).body, W.off);
  assert.equal(say({ status: 401 }).kind, 'signin');
  assert.equal(say({ status: 403, code: 'title', error: 'Its maker switched downloads off.' }).body, 'Its maker switched downloads off.');
  assert.equal(say({ status: 422, code: 'kind' }).body, lib.APP_WORDS.cantDownload);
  assert.equal(say({ status: 404 }).body, lib.APP_WORDS.cantDownload);
  assert.equal(say({ status: 429 }).body, lib.APP_WORDS.tooMany);
  assert.equal(say({ status: 503, code: 'migration-123', error: 'Downloads need a database update first (migration 123).' }).body, 'Downloads need a database update first (migration 123).');
  assert.equal(say({ status: 503, code: 'cloudflare' }).body, lib.APP_WORDS.fileNotReady);
  assert.equal(say({ status: 0 }).body, lib.APP_WORDS.unreachable);
  assert.equal(say({ status: 0, code: 'unsupported' }).body, lib.APP_WORDS.unsupported);
  assert.equal(say(null).kind, 'message');
  // The gate's own 403 (age, early screening, the plan's tier): its line.
  assert.equal(say({ status: 403, error: 'Early screening: this opens for your plan tomorrow.' }).body, 'Early screening: this opens for your plan tomorrow.');
});

t('while the file is being made: every 5 s for a minute, then every 15 s — 28 asks in five minutes', () => {
  assert.equal(lib.preparePollDelay(0), 5000);
  assert.equal(lib.preparePollDelay(59999), 5000);
  assert.equal(lib.preparePollDelay(60000), 15000);
  let waited = 0;
  let asks = 1; // the first, when Download is pressed
  while (waited < lib.PREPARE_MAX_MS) { waited += lib.preparePollDelay(waited); if (waited < lib.PREPARE_MAX_MS) asks += 1; }
  assert.equal(asks, 28);
  assert.ok(asks * 2 <= 60, 'two slow titles in an hour stay inside the route’s limit');
});

t('this phone is full at the shared limit', () => {
  assert.equal(logic.phoneFull(indexOf(Array.from({ length: rules.MAX_TITLES_PER_DEVICE - 1 }, (_, i) => item({ episodeId: `t${i}` })))), false);
  assert.equal(logic.phoneFull(indexOf(Array.from({ length: rules.MAX_TITLES_PER_DEVICE }, (_, i) => item({ episodeId: `t${i}` })))), true);
});

t('every word the app says is there, and none of the shared ones is retyped', () => {
  for (const [key, value] of Object.entries(lib.APP_WORDS)) assert.ok(typeof value === 'string' && value.length > 0, key);
  for (const shared of Object.values(W)) assert.ok(!Object.values(lib.APP_WORDS).includes(shared), `"${shared}" is in the shared rules`);
});

console.log(`\n${n} checks passed`);
