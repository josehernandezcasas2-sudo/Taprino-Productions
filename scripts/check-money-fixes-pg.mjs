// The money fixes of 2026-11-13 on a real Postgres (PGlite; see
// scripts/pg-chain.mjs), before and after migration 122:
//   - a membership invoice whose charge was refunded or disputed before it
//     was recorded: the payment row as 'reversed' and its credits written
//     with their reversals in one insert (stable ids, the reversals
//     pointing at their credits in the same statement); the same lines
//     again are refused (23505), which is how a repeat delivery or a racing
//     run can never credit twice; a won dispute's restore lines on top;
//   - a paid payment left without its lines (lib/creatorShare.js
//     writeMissingLines): the "has it any line?" read, the lines written,
//     a second write and the first run's late write both refused;
//   - the payout batch's claim (lib/payoutClaims.js claimLines, the real
//     function through a small PostgREST-like adapter) on 400 lines in parts
//     of 150, and short when another payout took a line first — the give
//     back frees only this payout's lines;
//   - ad credits (lib/studioMoney.js reverseAdCreditPurchase /
//     restoreAdCreditPurchase with lib/studioMoneyRules.js): a partial
//     refund, a dispute on the rest, the win — the guarded updates and the
//     balance functions leave the refund's part taken;
//   - the decided months creditAdShareBeforeDelete now reads.
// Run: node scripts/check-money-fixes-pg.mjs (needs PGlite, see pg-chain.mjs)
import assert from 'node:assert/strict';
import { buildDb, runMigration } from './pg-chain.mjs';
import { buildLedgerLines, reversalLinesFor, restoreLinesFor, stampLines } from '../lib/creatorShareRules.js';
import { withMembershipLineIds } from '../lib/ledgerIds.js';
import { claimLines } from '../lib/payoutClaims.js';
import { adCreditReversalTarget, adCreditDisputeOpen, adCreditDisputeGiveBack } from '../lib/studioMoneyRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const COLS = ['id', 'creator_id', 'lane', 'kind', 'cents', 'moves_money', 'member_id', 'payment_id', 'referral_id', 'payout_id', 'reverses_id', 'basis', 'note', 'created_by', 'studio'];
// One insert of several rows, the way PostgREST sends supabase-js's array
// insert (the union of the keys, a missing one as null). `withStudio`
// false drops the column, as lib/dbCompat.js insertManyCompat does before 122.
async function insertLines(db, lines, { withStudio = true } = {}) {
  const keys = COLS.filter((k) => (withStudio || k !== 'studio') && lines.some((l) => Object.prototype.hasOwnProperty.call(l, k)));
  const vals = [];
  const sqlRows = lines.map((l) => `(${keys.map((k) => { vals.push(l[k] === undefined ? null : l[k]); return `$${vals.length}`; }).join(', ')})`);
  return db.query(`insert into creator_ledger (${keys.join(', ')}) values ${sqlRows.join(', ')} returning *`, vals);
}
const refuses23505 = (p) => assert.rejects(p, (err) => err.code === '23505');
const sum = async (db, where, args) => Number((await db.query(`select coalesce(sum(cents), 0)::int as c from creator_ledger where ${where}`, args)).rows[0].c);

async function payment(db, row) {
  const cols = Object.keys(row);
  return (await db.query(`insert into member_payments (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, cols.map((c) => row[c]))).rows[0];
}
const entries = [{ id: 'user_mara', weight: 1 }, { id: 'user_dee', weight: 1 }];

// ---- before 122 -------------------------------------------------------------
const db = await buildDb(121);
{
  const pay = await payment(db, { user_id: 'user_member', stripe_invoice_id: 'in_refunded_first', tier: 'standard', amount_cents: 799, share_cents: 200, bonus_cents: 0, basis: 'picks', status: 'reversed', reversed_at: new Date().toISOString(), reverse_reason: 'refunded' });
  const credits = withMembershipLineIds(buildLedgerLines({ memberId: 'user_member', paymentId: pay.id, shareCents: 200, basis: 'picks', entries }));
  const lines = [...credits, ...withMembershipLineIds(reversalLinesFor(credits, 'membership payment refunded'))];
  const rows = (await insertLines(db, lines, { withStudio: false })).rows;
  assert.equal(rows.length, 4);
  assert.equal(await sum(db, 'payment_id = $1', [pay.id]), 0);
  assert.deepEqual(rows.filter((r) => r.kind === 'reversal').map((r) => r.reverses_id).sort(), credits.map((c) => c.id).sort());
  ok('before 122: an invoice refunded before it was recorded — payment reversed, credits and their reversals in one insert, netting 0');
}

// ---- 122 --------------------------------------------------------------------
await runMigration(db, 122);
{
  // Disputed before it was recorded: credits + reversals, stamped.
  const pay = await payment(db, { user_id: 'user_member', stripe_invoice_id: 'in_disputed_first', tier: 'standard', amount_cents: 865, tax_cents: 66, share_cents: 200, bonus_cents: 100, basis: 'picks', status: 'reversed', reversed_at: new Date().toISOString(), reverse_reason: 'disputed' });
  const referral = (await db.query(`insert into member_referrals (user_id, creator_id, stripe_subscription_id) values ('user_member', 'user_dee', 'sub_disputed') returning *`)).rows[0];
  const credits = withMembershipLineIds(stampLines(buildLedgerLines({ memberId: 'user_member', paymentId: pay.id, shareCents: 200, basis: 'picks', entries, referral, bonusCents: 100, paidAt: new Date().toISOString(), bonusMonths: 12 }), new Set()));
  const lines = [...credits, ...withMembershipLineIds(reversalLinesFor(credits, 'membership payment disputed'))];
  const rows = (await insertLines(db, lines)).rows;
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.studio === false));
  assert.equal(await sum(db, 'payment_id = $1', [pay.id]), 0);
  ok('after 122: disputed before it was recorded — reversed, stamped credits + reversals (one statement, self-referencing), netting 0');

  // The same lines again (a repeat delivery, a racing run): refused whole.
  await refuses23505(insertLines(db, lines));
  await refuses23505(insertLines(db, credits));
  assert.equal((await db.query('select count(*)::int c from creator_ledger where payment_id = $1', [pay.id])).rows[0].c, 6);
  ok('the same payment’s lines can’t go in twice (23505 on the stable ids), nothing doubled');

  // The bank rules for the studio: one adjustment per reversal (restoreMembershipCharge).
  const claimed = await db.query("update member_payments set restored_at = now() where id = $1 and restored_at is null returning id", [pay.id]);
  assert.equal(claimed.rows.length, 1);
  const reversals = (await db.query("select * from creator_ledger where payment_id = $1 and kind = 'reversal'", [pay.id])).rows;
  await insertLines(db, restoreLinesFor(reversals));
  assert.equal(await sum(db, 'payment_id = $1', [pay.id]), 300);
  assert.equal(await sum(db, "payment_id = $1 and creator_id = 'user_dee'", [pay.id]), 100 + 100);
  assert.equal((await db.query("update member_payments set restored_at = now() where id = $1 and restored_at is null returning id", [pay.id])).rows.length, 0);
  ok('a dispute won later restores those credits (share + bonus back, $3.00), once');
}
{
  // A paid payment whose lines never went in (writeMissingLines).
  const pay = await payment(db, { user_id: 'user_member', stripe_invoice_id: 'in_no_lines', tier: 'standard', amount_cents: 799, share_cents: 200, bonus_cents: 0, basis: 'picks', status: 'split' });
  const have = await db.query('select id from creator_ledger where payment_id = $1 limit 1', [pay.id]);
  assert.equal(have.rows.length, 0);
  const lines = withMembershipLineIds(stampLines(buildLedgerLines({ memberId: 'user_member', paymentId: pay.id, shareCents: pay.share_cents, basis: 'picks', entries }), new Set()));
  await insertLines(db, lines);
  assert.equal(await sum(db, 'payment_id = $1', [pay.id]), 200);
  // A second repair, or the first run's own late insert: refused, the payment stays.
  await refuses23505(insertLines(db, lines));
  assert.equal((await db.query('select id from member_payments where id = $1', [pay.id])).rows.length, 1);
  assert.equal(await sum(db, 'payment_id = $1', [pay.id]), 200);
  ok('a payment left without its lines: the read finds none, the lines go in; a second write (repair or late first run) is refused');
  // The basis update when the split came out differently.
  const upd = await db.query("update member_payments set basis = 'watched' where id = $1 returning basis", [pay.id]);
  assert.equal(upd.rows[0].basis, 'watched');
  ok('…and the payment’s basis can follow the lines');
}
{
  // The payout batch's claim, the real function on real rows.
  const pgClient = {
    from(table) {
      const q = { patch: null, filters: [] };
      const api = {
        update(patch) { q.patch = patch; return api; },
        in(col, values) { q.filters.push(['in', col, values]); return api; },
        is(col) { q.filters.push(['is', col]); return api; },
        async select(cols) {
          const vals = Object.values(q.patch);
          const sets = Object.keys(q.patch).map((k, i) => `${k} = $${i + 1}`);
          const where = q.filters.map(([op, col, v]) => {
            if (op === 'is') return `${col} is null`;
            vals.push(v);
            return `${col}::text = any($${vals.length}::text[])`;
          });
          try {
            const r = await db.query(`update ${table} set ${sets.join(', ')} where ${where.join(' and ')} returning ${cols}`, vals);
            return { data: r.rows, error: null };
          } catch (err) {
            return { data: null, error: { message: err.message, code: err.code } };
          }
        }
      };
      return api;
    }
  };
  const base = { lane: 'earnings', moves_money: true, kind: 'adjustment', created_by: 'check', studio: false };
  const made = (await insertLines(db, Array.from({ length: 400 }, () => ({ ...base, creator_id: 'user_many', cents: 1 })))).rows.map((r) => r.id);
  const po1 = (await db.query("insert into creator_payouts (creator_id, period, cents, status) values ('user_many', '2026-10', 400, 'pending') returning id")).rows[0].id;
  const out = await claimLines(pgClient, po1, made);
  assert.deepEqual(out, { count: 400, error: null });
  assert.equal((await db.query('select count(*)::int c from creator_ledger where payout_id = $1', [po1])).rows[0].c, 400);
  ok('the claim: 400 lines in parts of 150, every one taken by the payout');

  // Another payout took one line first: this one comes back short and gives back only its own.
  await db.query('update creator_ledger set payout_id = null where payout_id = $1', [po1]);
  const po2 = (await db.query("insert into creator_payouts (creator_id, period, cents, status) values ('user_many', '2026-10', 1, 'pending') returning id")).rows[0].id;
  await db.query('update creator_ledger set payout_id = $1 where id = $2', [po2, made[200]]);
  const po3 = (await db.query("insert into creator_payouts (creator_id, period, cents, status) values ('user_many', '2026-10', 400, 'pending') returning id")).rows[0].id;
  const short = await claimLines(pgClient, po3, made);
  assert.equal(short.error, null);
  assert.equal(short.count, 299);
  await db.query('update creator_ledger set payout_id = null where payout_id = $1', [po3]);
  assert.equal((await db.query('select count(*)::int c from creator_ledger where payout_id = $1', [po3])).rows[0].c, 0);
  assert.equal((await db.query('select payout_id from creator_ledger where id = $1', [made[200]])).rows[0].payout_id, po2);
  assert.equal((await db.query("select count(*)::int c from creator_ledger where creator_id = 'user_many' and payout_id is null")).rows[0].c, 399);
  ok('the claim: a line another payout took makes it short (299 of 400); the give back frees only this payout’s lines');
}
{
  // Ad credits: $100 bought, $30 refunded, the rest disputed, then won.
  const account = (await db.query("insert into ad_accounts (user_id, company_name, contact_email) values ('user_ads', 'Check Ads', 'ads@example.com') returning id")).rows[0].id;
  await db.query('select add_ad_credits($1, 10000)', [account]);
  const row = (await db.query("insert into ad_credit_purchases (ad_account_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents) values ($1, 'cs_ads', 'pi_ads', 10000) returning *", [account])).rows[0];
  const balance = async () => Number((await db.query('select credit_balance_cents from ad_accounts where id = $1', [account])).rows[0].credit_balance_cents);
  const read = async () => (await db.query('select reversed_cents, reverse_reason from ad_credit_purchases where id = $1', [row.id])).rows[0];
  // reverseAdCreditPurchase's claim and the balance, as the lib sends them.
  async function reverse({ refundedCents, disputedCents = null, reason }) {
    const cur = await read();
    const before = cur.reversed_cents;
    const open = adCreditDisputeOpen(cur.reverse_reason);
    if (disputedCents !== null && open) return 0;
    const target = adCreditReversalTarget({ amountCents: 10000, refundedCents, disputedCents: disputedCents || 0 });
    const delta = target - before;
    if (delta <= 0) return 0;
    const claimed = await db.query('update ad_credit_purchases set reversed_cents = $1, reversed_at = now(), reverse_reason = $2 where id = $3 and reversed_cents = $4 returning id', [target, open ? cur.reverse_reason : reason, row.id, before]);
    if (!claimed.rows.length) return 0;
    await db.query('select remove_ad_credits($1, $2)', [account, delta]);
    return delta;
  }
  async function restore({ disputedCents }) {
    const cur = await read();
    if (!adCreditDisputeOpen(cur.reverse_reason)) return 0;
    const give = adCreditDisputeGiveBack({ reversedCents: cur.reversed_cents, disputedCents });
    if (give <= 0) return 0;
    const claimed = await db.query("update ad_credit_purchases set reversed_cents = $1, reverse_reason = 'dispute won' where id = $2 and reversed_cents = $3 and reverse_reason = $4 returning id", [cur.reversed_cents - give, row.id, cur.reversed_cents, cur.reverse_reason]);
    if (!claimed.rows.length) return 0;
    await db.query('select add_ad_credits($1, $2)', [account, give]);
    return give;
  }
  assert.equal(await reverse({ refundedCents: 3000, reason: 'refunded' }), 3000);
  assert.equal(await balance(), 7000);
  assert.equal(await reverse({ refundedCents: 3000, disputedCents: 7000, reason: 'disputed' }), 7000);
  assert.equal(await balance(), 0);
  assert.deepEqual(await read(), { reversed_cents: 10000, reverse_reason: 'disputed' });
  assert.equal(await reverse({ refundedCents: 3000, disputedCents: 7000, reason: 'disputed' }), 0, 'a replayed dispute takes nothing more');
  assert.equal(await reverse({ refundedCents: 3000, reason: 'refunded' }), 0, 'a replayed refund takes nothing more');
  assert.equal(await restore({ disputedCents: 7000 }), 7000);
  assert.equal(await balance(), 7000);
  assert.deepEqual(await read(), { reversed_cents: 3000, reverse_reason: 'dispute won' });
  assert.equal(await restore({ disputedCents: 7000 }), 0, 'a replayed win gives nothing back');
  assert.equal(await balance(), 7000);
  ok('ad credits: refund $30, dispute $70, won — the balance ends at $70 (the refund stays taken), replays move nothing');
}
{
  // creditAdShareBeforeDelete's read of the decided months.
  await db.query("insert into audit_log (admin_id, action, target_type, target_id, details) values ('cron', 'ad_share_month', 'ad_share', '2026-08', 'x'), ('cron', 'ad_share_month', 'ad_share', '2026-09', 'x'), ('cron', 'other', 'ad_share', '2026-10', 'x')");
  const decided = (await db.query("select target_id from audit_log where action = 'ad_share_month' and target_id = any($1)", [['2026-08', '2026-10', '2026-11']])).rows.map((r) => r.target_id);
  assert.deepEqual(decided, ['2026-08']);
  ok('the decided months read: only months with an ad_share_month line among those asked');
}

console.log(`\n${n} passed`);
