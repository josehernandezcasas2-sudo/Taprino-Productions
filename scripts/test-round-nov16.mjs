// Run: node scripts/test-round-nov16.mjs
// The pure parts of three fixes from round 3's open list (2026-11-16,
// mockups/refund-hold-contract.md section B):
//   - a buyer's own refund and a download of the title can't both win
//     (migration 125 purchases.refund_started_at): the claim and its
//     staleness, which download rows count, when a download is refused,
//     and every order the two requests' steps can land in;
//   - a location request past its time reads as expired and is acted on
//     as such without waiting for the sweep, which runs at most once a
//     minute;
//   - an applicant's private artwork reference stays inside its folder.
// The routes themselves are checked on the rig:
// dev/test-rig/checks/round-nov16.mjs.
import assert from 'node:assert/strict';
import {
  DOWNLOAD_REFUNDING_LINE, REFUND_BLOCKS, REFUND_CLAIM_STALE_MS, countsAsDownloaded, refundBlocksDownload, refundClaimLive, refundEligibility
} from '../lib/purchaseRules.js';
import { EXPIRY_EVERY_MS, RESPONDING_STATUSES, expiryDue, outOfTime, shownStatus } from '../lib/requestExpiryRules.js';
import { safePrivatePath } from '../lib/uploadRefRules.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok — ${name}`);
}

const NOW = Date.parse('2026-11-16T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

/* ---------- 1. a self refund and a download ---------- */

test('the words are the agreed ones', () => {
  assert.equal(REFUND_BLOCKS.inFlight.message, 'A refund for this is already on its way.');
  assert.equal(DOWNLOAD_REFUNDING_LINE, 'This title is being refunded, so it can’t be downloaded.');
  assert.equal(REFUND_CLAIM_STALE_MS, 10 * 60 * 1000);
});

test('refundClaimLive: a claim is live for ten minutes, then stale', () => {
  assert.equal(refundClaimLive(null, NOW), false);
  assert.equal(refundClaimLive('', NOW), false);
  assert.equal(refundClaimLive('not a date', NOW), false);
  assert.equal(refundClaimLive(ago(0), NOW), true);
  assert.equal(refundClaimLive(ago(9 * 60 * 1000), NOW), true);
  assert.equal(refundClaimLive(ago(10 * 60 * 1000 - 1), NOW), true);
  assert.equal(refundClaimLive(ago(10 * 60 * 1000), NOW), false);
  assert.equal(refundClaimLive(ago(3600 * 1000), NOW), false);
  // A stamp a little ahead of this server's clock is still a live claim.
  assert.equal(refundClaimLive(new Date(NOW + 5000).toISOString(), NOW), true);
  // `now` as a Date works the same.
  assert.equal(refundClaimLive(ago(60 * 1000), new Date(NOW)), true);
});

test('countsAsDownloaded: dated rows always, undated ones only while active', () => {
  assert.equal(countsAsDownloaded({ licensed_until: ago(-86400000), status: 'active' }), true);
  // The link went out with the date, whatever became of the copy since.
  assert.equal(countsAsDownloaded({ licensed_until: ago(0), status: 'removed' }), true);
  assert.equal(countsAsDownloaded({ licensed_until: ago(0), status: 'revoked' }), true);
  // Being started: no date yet, its link may go out any moment.
  assert.equal(countsAsDownloaded({ licensed_until: null, status: 'active' }), true);
  // Taken back at once (a limit, a refusal) or freed before a link: never a link.
  assert.equal(countsAsDownloaded({ licensed_until: null, status: 'revoked' }), false);
  assert.equal(countsAsDownloaded({ licensed_until: null, status: 'removed' }), false);
  assert.equal(countsAsDownloaded(null), false);
});

test('refundBlocksDownload: no completed purchase left, or any refund on its way', () => {
  const ep = (over = {}) => ({ id: 'p-ep', status: 'completed', refund_started_at: null, ...over });
  const show = (over = {}) => ({ id: 'p-show', status: 'completed', refund_started_at: null, ...over });
  assert.equal(refundBlocksDownload([], NOW), true, 'nothing covers it any more');
  assert.equal(refundBlocksDownload(null, NOW), true);
  assert.equal(refundBlocksDownload([ep()], NOW), false);
  assert.equal(refundBlocksDownload([ep({ refund_started_at: ago(1000) })], NOW), true, 'a refund on its way');
  assert.equal(refundBlocksDownload([ep({ refund_started_at: ago(11 * 60 * 1000) })], NOW), false, 'a refund that died long ago');
  assert.equal(refundBlocksDownload([ep({ status: 'refunded', refund_started_at: ago(1000) })], NOW), true, 'refunded since the start');
  assert.equal(refundBlocksDownload([ep({ status: 'disputed' })], NOW), true, 'disputed since the start');
  // An old refunded purchase next to the one that owns it now.
  assert.equal(refundBlocksDownload([ep({ status: 'refunded', refund_started_at: ago(86400000) }), show()], NOW), false);
  // Any covering purchase with a refund in flight refuses, even with another one.
  assert.equal(refundBlocksDownload([ep({ refund_started_at: ago(1000) }), show()], NOW), true);
});

test('refundEligibility: a refund on its way shows on the card before anything else', () => {
  const p = { status: 'completed', completed_at: ago(86400000), watched_max: {} };
  const fine = refundEligibility(p, { now: new Date(NOW) });
  assert.equal(fine.ok, true);
  const busy = refundEligibility(p, { now: new Date(NOW), refunding: true });
  assert.equal(busy.ok, false);
  assert.equal(busy.reason, REFUND_BLOCKS.inFlight.reason);
  assert.equal(busy.message, REFUND_BLOCKS.inFlight.message);
  // A purchase that isn't completed says so first.
  assert.equal(refundEligibility({ ...p, status: 'refunded' }, { now: new Date(NOW), refunding: true }).reason, 'already refunded');
});

// Every order the two requests' steps can land in. The refund: claim the
// purchase, then read the downloads (a row being started counts). The
// download: write its row, then read the purchases. Each read sees every
// write that landed before it (one statement after another, each
// committed). Never may the refund go ahead AND the download hand out a
// link; at least one of them always sees the other.
test('a self refund and a download never both win, whatever the order', () => {
  const steps = { refund: ['claim', 'readDownloads'], download: ['insertRow', 'readPurchases'] };
  const orders = [];
  (function weave(a, b, acc) {
    if (a.length === 0 && b.length === 0) return orders.push(acc);
    if (a.length) weave(a.slice(1), b, [...acc, ['refund', a[0]]]);
    if (b.length) weave(a, b.slice(1), [...acc, ['download', b[0]]]);
  })(steps.refund, steps.download, []);
  assert.equal(orders.length, 6);
  let bothRefused = 0;
  for (const order of orders) {
    const purchase = { id: 'p', status: 'completed', refund_started_at: null };
    const rows = [];
    let refundSees = null;
    let downloadSees = null;
    for (const [who, step] of order) {
      if (step === 'claim') purchase.refund_started_at = new Date(NOW).toISOString();
      if (step === 'insertRow') rows.push({ licensed_until: null, status: 'active' });
      if (step === 'readDownloads') refundSees = rows.filter(countsAsDownloaded).length > 0;
      if (step === 'readPurchases') downloadSees = refundBlocksDownload([{ ...purchase }], NOW);
    }
    const refundGoes = !refundSees;
    const downloadGoes = !downloadSees;
    assert.ok(!(refundGoes && downloadGoes), `both won in the order ${order.map(([w, s]) => `${w}:${s}`).join(' → ')}`);
    if (!refundGoes && !downloadGoes) bothRefused += 1;
  }
  // Both refused only when they overlap exactly (each asked again).
  assert.ok(bothRefused >= 1 && bothRefused < 6);
  // The old rule (only dated rows count) loses this race: the download's
  // row is undated until its link goes out.
  const oldRuleSeesIt = [{ licensed_until: null, status: 'active' }].some((r) => Boolean(r.licensed_until));
  assert.equal(oldRuleSeesIt, false);
});

/* ---------- 2. location requests past their time ---------- */

test('outOfTime: only a request waiting on an answer, once its time has passed', () => {
  assert.deepEqual([...RESPONDING_STATUSES], ['requested', 'countered']);
  const past = ago(60 * 1000);
  const future = ago(-60 * 1000);
  assert.equal(outOfTime({ status: 'requested', responds_by: past }, NOW), true);
  assert.equal(outOfTime({ status: 'countered', responds_by: past }, NOW), true);
  assert.equal(outOfTime({ status: 'requested', responds_by: future }, NOW), false);
  assert.equal(outOfTime({ status: 'requested', responds_by: new Date(NOW).toISOString() }, NOW), false, 'the last moment is still in time');
  for (const status of ['accepted', 'paid', 'done', 'declined', 'expired', 'cancelled', 'refunded']) {
    assert.equal(outOfTime({ status, responds_by: past }, NOW), false, status);
  }
  assert.equal(outOfTime({ status: 'requested', responds_by: null }, NOW), false);
  assert.equal(outOfTime({ status: 'requested', responds_by: 'not a date' }, NOW), false);
  assert.equal(outOfTime(null, NOW), false);
});

test('shownStatus: past its time reads as expired before the sweep gets there', () => {
  assert.equal(shownStatus({ status: 'requested', responds_by: ago(1) }, NOW), 'expired');
  assert.equal(shownStatus({ status: 'countered', responds_by: ago(1) }, NOW), 'expired');
  assert.equal(shownStatus({ status: 'requested', responds_by: ago(-1000) }, NOW), 'requested');
  assert.equal(shownStatus({ status: 'accepted', responds_by: ago(1000) }, NOW), 'accepted');
  assert.equal(shownStatus({ status: 'expired', responds_by: ago(1000) }, NOW), 'expired');
  assert.equal(shownStatus(null, NOW), null);
});

test('expiryDue: at most once a minute on one server', () => {
  assert.equal(EXPIRY_EVERY_MS, 60 * 1000);
  assert.equal(expiryDue(0, NOW), true, 'never run');
  assert.equal(expiryDue(NOW, NOW), false);
  assert.equal(expiryDue(NOW - 59 * 1000, NOW), false);
  assert.equal(expiryDue(NOW - 60 * 1000, NOW), true);
  assert.equal(expiryDue(undefined, NOW), true);
});

/* ---------- 3. an applicant's private artwork ---------- */

test('an applicant’s artwork reference stays inside the private folder', () => {
  const id = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';
  assert.equal(safePrivatePath(`apply-${id}-poster-0a1b2c3d4e5f6a7b8c.jpg`), `apply-${id}-poster-0a1b2c3d4e5f6a7b8c.jpg`);
  assert.equal(safePrivatePath(`apply-${id}-thumbnail-0a1b2c3d4e5f6a7b8c.webp`), `apply-${id}-thumbnail-0a1b2c3d4e5f6a7b8c.webp`);
  assert.equal(safePrivatePath('apply-x/../captions/a.vtt'), null);
});

console.log(`\n${passed} passed`);
