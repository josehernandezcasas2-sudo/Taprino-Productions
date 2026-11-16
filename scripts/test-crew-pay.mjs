// node scripts/test-crew-pay.mjs — secured crew pay's pure rules
// (lib/crewPayRules.js): the quote, the release hold (security round 2) and
// the refund hold (migration 125, 2026-11-16), and the app's copy of the
// shared block (mobile/src/lib/crewPayRules.js) word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// lib/crewPayRules.js imports './donationMath' without an extension (the
// bundler resolves it); Node's ESM loader doesn't, so the source is loaded
// with that one import pointed at the real file.
const source = readFileSync(new URL('../lib/crewPayRules.js', import.meta.url), 'utf8').replace("from './donationMath'", `from '${new URL('../lib/donationMath.js', import.meta.url).href}'`);
const web = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { crewPayQuote, releaseHoldDays, holdUntilFrom, holdActive, holdLabel, RELEASE_HOLD_DAYS, ESTABLISHED_ACCOUNT_DAYS } = web;
const appSource = readFileSync(new URL('../mobile/src/lib/crewPayRules.js', import.meta.url), 'utf8');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('quote: the fee and the card cover sit on top of the rate', () => {
  const q = crewPayQuote(35000, 8);
  assert.equal(q.amountCents, 35000);
  assert.equal(q.cutCents, 2800);
  assert.equal(q.totalCents, 35000 + 2800 + q.feeCents);
  assert.ok(q.feeCents > 0);
});

t('hold: two established accounts and a worker paid before release at once', () => {
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: 90, workerPaidBefore: true }), 0);
});

t('hold: a young poster, a young worker, a first payout or an unknown age all wait', () => {
  assert.equal(releaseHoldDays({ posterAgeDays: 2, workerAgeDays: 90, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: ESTABLISHED_ACCOUNT_DAYS - 1, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: 200, workerAgeDays: 90, workerPaidBefore: false }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({ posterAgeDays: null, workerAgeDays: 90, workerPaidBefore: true }), RELEASE_HOLD_DAYS);
  assert.equal(releaseHoldDays({}), RELEASE_HOLD_DAYS);
});

t('hold: the date and whether it is still in force', () => {
  const from = new Date('2026-10-28T12:00:00Z');
  assert.equal(holdUntilFrom(from, 7), '2026-11-04T12:00:00.000Z');
  assert.equal(holdUntilFrom(from, 0), from.toISOString());
  assert.equal(holdActive('2026-11-04T12:00:00.000Z', new Date('2026-11-01T00:00:00Z')), true);
  assert.equal(holdActive('2026-11-04T12:00:00.000Z', new Date('2026-11-04T12:00:00.001Z')), false);
  assert.equal(holdActive(null), false);
  assert.equal(holdLabel('2026-11-04T12:00:00.000Z'), 'releases Nov 4');
  assert.equal(holdLabel(null), '');
});

const block = (src) => {
  const a = src.indexOf('// shared:start');
  const b = src.indexOf('// shared:end');
  assert.ok(a >= 0 && b > a, 'the shared block is marked');
  return src.slice(a, b + '// shared:end'.length);
};

t('the app copy is the shared block word for word, and imports nothing', () => {
  assert.equal(block(appSource), block(source));
  assert.ok(!/^\s*import\s/m.test(appSource), 'mobile/src/lib/crewPayRules.js imports nothing');
  assert.ok(!/^\s*import\s/m.test(block(source)), 'the shared block imports nothing');
  // Nothing but the header comment and the block.
  const rest = appSource.replace(block(appSource), '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
  assert.deepEqual(rest, []);
  for (const name of Object.keys(app)) assert.equal(typeof web[name], typeof app[name], name);
  assert.equal(app.payDollars(35000), web.payDollars(35000));
});

const asked = new Date('2026-11-16T18:00:00Z');
const due = '2026-11-19T18:00:00.000Z';
const held = (extra = {}) => ({ status: 'held', worker_id: 'user_w', refund_due_at: due, refund_kind: 'no_show', contested_at: null, contest_decision: null, ...extra });

t('refund: what goes back for each kind', () => {
  assert.equal(web.refundAskedCents('no_show', { totalCents: 22300, feeCents: 700 }), 22300);
  assert.equal(web.refundAskedCents('cancelled', { totalCents: 22300, feeCents: 700 }), 21600);
  assert.equal(web.refundAskedCents('unbooked', { totalCents: 22300, feeCents: 700 }), 21600);
  assert.equal(web.refundAskedCents('cancelled', { totalCents: 500, feeCents: 900 }), 0);
  assert.equal(web.refundReasonWords('no_show'), 'the job didn’t happen');
  assert.equal(web.refundReasonWords('cancelled'), 'the booking was cancelled');
  assert.equal(web.refundReasonWords('unbooked'), 'they were taken off the job');
  assert.equal(web.refundKindWords('no_show'), 'Didn’t happen');
  assert.equal(web.refundKindWords('cancelled'), 'Cancelled');
  assert.equal(web.refundKindWords('unbooked'), 'Taken off the job');
  assert.equal(web.refundKindWords('toString'), '');
  assert.deepEqual(web.REFUND_KINDS, ['no_show', 'cancelled', 'unbooked']);
});

t('refund: due three days on, named on the Pacific calendar', () => {
  assert.equal(web.REFUND_WAIT_DAYS, 3);
  assert.equal(web.refundDueFrom(asked), due);
  assert.equal(web.refundDueFrom(asked.toISOString()), due);
  assert.equal(web.payDay(due), 'Nov 19');
  // 02:00 UTC on Nov 20 is still Nov 19 in California.
  assert.equal(web.payDay('2026-11-20T02:00:00Z'), 'Nov 19');
  assert.equal(web.payDay(null), '');
});

t('refund: where a payment stands at each moment', () => {
  assert.equal(web.refundState(null), 'none');
  assert.equal(web.refundState(held({ refund_due_at: null })), 'none');
  assert.equal(web.refundState(held(), new Date('2026-11-17T00:00:00Z')), 'waiting');
  assert.equal(web.refundState(held(), new Date('2026-11-19T17:59:59Z')), 'waiting');
  assert.equal(web.refundState(held(), new Date('2026-11-19T18:00:00Z')), 'due');
  assert.equal(web.refundState(held({ contested_at: '2026-11-17T00:00:00Z' }), new Date('2026-11-25T00:00:00Z')), 'contested');
  assert.equal(web.refundState(held({ contest_decision: 'release' })), 'none');
  assert.equal(web.refundState(held({ status: 'disputed' })), 'none');
  assert.equal(web.refundState(held({ status: 'refunded' })), 'none');
  // The pages' shape reads the same.
  assert.equal(web.refundState({ status: 'held', refundDueAt: due, contestedAt: null, contestDecision: null }, new Date('2026-11-17T00:00:00Z')), 'waiting');
  // The poster's change of mind: a no-show or a cancellation, until it goes back.
  assert.equal(web.canChangeToWorked(held(), new Date('2026-11-17T00:00:00Z')), true);
  assert.equal(web.canChangeToWorked(held({ refund_kind: 'cancelled', contested_at: '2026-11-17T00:00:00Z' })), true);
  assert.equal(web.canChangeToWorked(held({ refund_kind: 'unbooked' }), new Date('2026-11-17T00:00:00Z')), false);
  assert.equal(web.canChangeToWorked(held({ contest_decision: 'refund' })), false);
});

t('refund: the refusals a contest can meet', () => {
  const at = new Date('2026-11-17T00:00:00Z');
  const note = 'We shot all day on Saturday; the call sheet has my name.';
  assert.equal(web.contestRefusal(held(), { userId: 'user_w', note, now: at }), null);
  assert.equal(web.contestRefusal(held(), { userId: 'user_poster', note, now: at }).status, 403);
  assert.equal(web.contestRefusal(held(), { userId: null, note, now: at }).code, 'not-yours');
  assert.equal(web.contestRefusal(held({ status: 'refunded' }), { userId: 'user_w', note, now: at }).code, 'not-held');
  assert.equal(web.contestRefusal(held({ refund_due_at: null }), { userId: 'user_w', note, now: at }).code, 'no-refund');
  assert.equal(web.contestRefusal(held({ contested_at: '2026-11-16T20:00:00Z' }), { userId: 'user_w', note, now: at }).code, 'contested');
  assert.equal(web.contestRefusal(held({ contest_decision: 'refund' }), { userId: 'user_w', note, now: at }).code, 'decided');
  assert.equal(web.contestRefusal(held(), { userId: 'user_w', note, now: new Date('2026-11-20T00:00:00Z') }).code, 'due');
  assert.equal(web.contestRefusal(held(), { userId: 'user_w', note: '  short   ', now: at }).code, 'note-short');
  assert.equal(web.contestRefusal(held(), { userId: 'user_w', note: 'x'.repeat(1001), now: at }).code, 'note-long');
  assert.equal(web.contestRefusal(held(), { userId: 'user_w', note: 'x'.repeat(1000), now: at }), null);
  for (const r of [web.contestRefusal(held(), { userId: 'x', note, now: at }), web.contestRefusal(held(), { userId: 'user_w', note: '', now: at })]) {
    assert.ok(r.error && !/[{}]/.test(r.error), r.error);
  }
});

t('refund: the words on both sides', () => {
  assert.equal(web.refundAskedNotice({ posterName: 'Mara Reyes', kind: 'no_show', title: 'Night Bus', amountCents: 20000, dueAt: due }), 'Mara Reyes says the job didn’t happen on Night Bus. The $200 secured for you goes back to them on Nov 19 unless you tell us otherwise.');
  assert.equal(web.refundAskedNotice({ posterName: 'Mara Reyes', kind: 'unbooked', title: 'Night Bus', amountCents: 20000, dueAt: due }), 'Mara Reyes says you’re off the job on Night Bus. The $200 secured for you goes back to them on Nov 19 unless you tell us otherwise.');
  assert.equal(web.workerRefundBox({ posterFirstName: 'Mara', kind: 'no_show', amountCents: 20000, dueAt: due }), 'Mara says the job didn’t happen. The $200 goes back to them on Nov 19 unless you tell us otherwise.');
  assert.equal(web.workerRefundBox({ posterFirstName: 'Mara', kind: 'cancelled', amountCents: 20000, dueAt: due }), 'Mara says the job was cancelled. The $200 goes back to them on Nov 19 unless you tell us otherwise.');
  assert.equal(web.workerRefundBox({ posterFirstName: 'Mara', kind: 'no_show', amountCents: 20000, dueAt: due, contestedAt: '2026-11-16T20:00:00Z' }), 'You told the studio on Nov 16. The $200 stays held until someone there decides; they may write to you both.');
  assert.equal(web.posterRefundChip(held(), new Date('2026-11-17T00:00:00Z')), 'Refund Nov 19');
  assert.equal(web.posterRefundChip(held({ contested_at: '2026-11-17T00:00:00Z' })), 'Contested');
  assert.equal(web.posterRefundChip(held({ refund_due_at: null })), '');
  assert.equal(web.posterRefundLine({ workerFirstName: 'Dee', amountCents: 22300, dueAt: due }), 'The $223 goes back to your card on Nov 19 unless Dee says otherwise.');
  assert.equal(web.posterRefundLine({ workerFirstName: 'Dee', amountCents: 22300, dueAt: due, contested: true }), 'Dee says the job happened. The $223 stays held until the studio decides.');
  assert.equal(web.contestedNotice({ workerName: 'Dee Park', title: 'Night Bus', amountCents: 22300 }), 'Dee Park says the job on Night Bus happened. The $223 stays held until the studio decides — we may write to you both.');
  assert.equal(web.refundDecidedNotice({ side: 'worker', decision: 'release', title: 'Night Bus', amountCents: 20000 }), 'The studio looked at Night Bus: the $200 is yours.');
  assert.equal(web.refundDecidedNotice({ side: 'worker', decision: 'refund', title: 'Night Bus', amountCents: 20000 }), 'The studio looked at Night Bus: the $200 goes back to the poster.');
  assert.equal(web.refundDecidedNotice({ side: 'poster', decision: 'release', title: 'Night Bus', amountCents: 20000 }), 'The studio looked at Night Bus: the $200 goes to the crew member.');
  assert.equal(web.refundDecidedNotice({ side: 'poster', decision: 'refund', title: 'Night Bus', amountCents: 22300 }), 'The studio looked at Night Bus: the $223 goes back to you.');
  assert.equal(web.cardRefundWords(held(), new Date('2026-11-17T00:00:00Z')), 'refund asked, goes back Nov 19');
  assert.equal(web.cardRefundWords(held({ contested_at: '2026-11-17T00:00:00Z' })), 'refund asked · you contested it');
  assert.equal(web.cardRefundWords(held({ refund_due_at: null })), '');
  assert.equal(web.adminRefundLine(held(), new Date('2026-11-17T00:00:00Z')), 'Refund asked by the poster · Didn’t happen · goes back Nov 19');
  assert.equal(web.adminRefundLine(held({ refund_kind: 'unbooked', contested_at: '2026-11-17T00:00:00Z' })), 'Refund asked by the poster · Taken off the job · goes back Nov 19 · Contested');
  assert.equal(web.CONTEST_BUTTON, 'It happened — tell the studio');
  assert.equal(web.CONTEST_PLACEHOLDER, 'What happened? The studio reads this.');
  assert.equal(web.WORKED_AFTER_ALL_BUTTON, 'They worked it after all');
  assert.equal(web.REFUND_BEFORE_125_LINE, 'The secured pay stays held until the studio settles it.');
});

console.log(`${n} passed`);
