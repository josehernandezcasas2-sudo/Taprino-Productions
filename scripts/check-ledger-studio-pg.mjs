// The money edge cases of 2026-11-12 on a real Postgres (PGlite; see
// scripts/pg-chain.mjs): every creator_ledger line shape the code now writes
// with `studio` (migration 122) — the invoice's shares and referral bonus,
// reversals and restores that inherit their credit's stamp, a cancelled
// credit, ad share lines with their ids, the leaver's forfeit and the pool,
// the payout line, a reversed payout's adjustment — goes in after 122 with
// the stamp and, before 122, without it (what lib/dbCompat.js
// insertManyCompat falls back to); the owed split the payout batch makes
// from those rows (lib/creatorShareRules.js owedByStudio + planPayouts)
// pays a promoted creator their earlier credits and never pays a demoted
// one what the studio kept; and the claim the catch-up makes on an
// unfinished stripe_events row (lib/stripeEvents.js claimUnfinished) wins
// once, never twice, and never on a finished row.
// Run: node scripts/check-ledger-studio-pg.mjs
import assert from 'node:assert/strict';
import { buildDb, runMigration } from './pg-chain.mjs';
import { owedByStudio, planPayouts, reversalLinesFor, restoreLinesFor, stampLines, forfeitLines } from '../lib/creatorShareRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const COLS = ['id', 'creator_id', 'lane', 'kind', 'cents', 'moves_money', 'member_id', 'payment_id', 'referral_id', 'payout_id', 'reverses_id', 'basis', 'note', 'created_by', 'episode_id', 'units', 'period', 'studio', 'created_at'];
// One insert of several rows, the way PostgREST sends supabase-js's array
// insert: the union of the keys, a missing one as null.
// A row without an id takes the default (every row of a batch here either
// has one or not, as the code's batches do).
async function insertLines(db, lines) {
  const keys = COLS.filter((k) => lines.some((l) => Object.prototype.hasOwnProperty.call(l, k)));
  const hasId = keys.includes('id') && lines.every((l) => l.id !== undefined);
  const cols = hasId ? keys : keys.filter((k) => k !== 'id');
  const vals = [];
  const sqlRows = lines.map((l) => `(${cols.map((k) => { vals.push(l[k] === undefined ? null : l[k]); return `$${vals.length}`; }).join(', ')})`);
  return db.query(`insert into creator_ledger (${cols.join(', ')}) values ${sqlRows.join(', ')} returning *`, vals);
}

// --- before 122: a line naming `studio` is refused; without it, as always.
const db = await buildDb(121);
const base = { lane: 'earnings', moves_money: true };
await assert.rejects(insertLines(db, [{ ...base, creator_id: 'user_mara', kind: 'adjustment', cents: 100, studio: false }]), (err) => err.code === '42703');
await insertLines(db, [{ ...base, creator_id: 'user_mara', kind: 'adjustment', cents: 100 }]);
ok('before 122: a line with studio fails with 42703 (the compat retry’s cue); the same line without it goes in');

// --- 122.
await runMigration(db, 122);
const old = (await db.query("select * from creator_ledger where creator_id = 'user_mara'")).rows[0];
assert.equal(old.studio, null);
ok('122 runs; the line written before it reads studio = null (placed by the role now)');

// A paid invoice: picks of Mara and of the studio's account, a referral bonus.
const payment = (await db.query(`insert into member_payments (user_id, stripe_invoice_id, tier, amount_cents, share_cents, bonus_cents, basis, status)
  values ('user_member', 'in_rig1', 'premium', 1299, 350, 150, 'picks', 'split') returning id`)).rows[0];
const referral = (await db.query(`insert into member_referrals (user_id, creator_id, stripe_subscription_id) values ('user_member', 'user_dee', 'sub_rig1') returning id`)).rows[0];
const invoiceLines = stampLines([
  { ...base, creator_id: 'user_mara', kind: 'member_share', cents: 175, member_id: 'user_member', payment_id: payment.id, basis: 'picks' },
  { ...base, creator_id: 'user_admin', kind: 'member_share', cents: 175, member_id: 'user_member', payment_id: payment.id, basis: 'picks' },
  { ...base, creator_id: 'user_dee', kind: 'referral', cents: 150, member_id: 'user_member', payment_id: payment.id, referral_id: referral.id, basis: null }
], new Set(['user_admin']));
const written = (await insertLines(db, invoiceLines)).rows;
assert.deepEqual(written.map((r) => [r.creator_id, r.kind, r.studio]), [['user_mara', 'member_share', false], ['user_admin', 'member_share', true], ['user_dee', 'referral', false]]);
ok('the invoice’s lines (shares + referral bonus) go in stamped from the role read');

// A dispute reverses them (inheriting each stamp, null included), and a won
// dispute restores them the same way.
const all = (await db.query('select * from creator_ledger order by created_at, id')).rows;
const reversals = reversalLinesFor([...all.filter((r) => r.payment_id === payment.id), old], 'membership payment disputed');
const revRows = (await insertLines(db, reversals)).rows;
assert.deepEqual(revRows.map((r) => [r.creator_id, r.cents, r.studio]).sort(), [['user_admin', -175, true], ['user_dee', -150, false], ['user_mara', -100, null], ['user_mara', -175, false]].sort());
const restores = restoreLinesFor(revRows);
const restRows = (await insertLines(db, restores)).rows;
assert.deepEqual(restRows.map((r) => [r.creator_id, r.kind, r.cents, r.studio]).sort(), [['user_admin', 'adjustment', 175, true], ['user_dee', 'adjustment', 150, false], ['user_mara', 'adjustment', 100, null], ['user_mara', 'adjustment', 175, false]].sort());
ok('reversals and restores go in with their credit’s stamp (true, false, or null for a pre-122 credit)');

// A cancelled credit, ad share lines with their (title, month) ids.
await insertLines(db, stampLines([{ ...base, creator_id: 'user_dee', kind: 'adjustment', cents: -50, note: 'cancelled: test', created_by: 'user_admin' }], new Set()));
const adIds = ['5b3c2a9e-1111-5aaa-8bbb-000000000001', '5b3c2a9e-1111-5aaa-8bbb-000000000002'];
await insertLines(db, stampLines([
  { ...base, id: adIds[0], creator_id: 'user_mara', kind: 'ad_share', cents: 40, basis: null, episode_id: 'night-bus-e1-lx3k9a', units: 12, period: '2026-09', note: 'Night Bus · 12 ads', created_by: 'cron' },
  { ...base, id: adIds[1], creator_id: 'user_dee', kind: 'ad_share', cents: 30, basis: null, episode_id: 'salt-hours-qq9a1b', units: 9, period: '2026-10', note: 'The Salt Hours · 9 ads', created_by: 'cron' }
], new Set()));
assert.deepEqual((await db.query('select studio from creator_ledger where id = any($1) order by id', [adIds])).rows.map((r) => r.studio), [false, false]);
await assert.rejects(insertLines(db, [{ ...base, id: adIds[0], creator_id: 'user_mara', kind: 'ad_share', cents: 40, period: '2026-09', studio: false }]), (err) => err.code === '23505');
ok('a cancelled credit and ad share lines go in stamped; a month’s line id can’t go in twice');

// A leaver's forfeit to the pool: forfeit says false itself, the pool stamped.
await insertLines(db, stampLines(forfeitLines({ creatorId: 'user_gone', cents: 300, pool: { user_mara: 2, user_dee: 1 }, createdBy: 'cron' }), new Set(['user_admin'])));
assert.deepEqual((await db.query("select kind, studio from creator_ledger where kind in ('forfeit', 'pool_share') order by kind, creator_id")).rows.map((r) => [r.kind, r.studio]), [['forfeit', false], ['pool_share', false], ['pool_share', false]]);
ok('the forfeit and the pool lines go in stamped');

// A payout of Mara's own lines and a reversal of it in Stripe.
const payout = (await db.query("insert into creator_payouts (creator_id, period, cents, status) values ('user_mara', '2026-10', 175, 'pending') returning id")).rows[0];
await insertLines(db, [{ ...base, creator_id: 'user_mara', kind: 'payout', cents: -175, payout_id: payout.id, note: 'transfer tr_1', created_by: 'cron', studio: false }]);
await insertLines(db, [{ ...base, creator_id: 'user_mara', kind: 'adjustment', cents: 75, note: 'payout reversed', created_by: 'stripe', studio: false }]);
ok('the payout line and a reversed payout’s adjustment go in with studio false');

// --- the owed split the batch reads (id, creator_id, cents, created_at, studio).
// Mara was promoted (is the studio now): her stamped-false credits are still
// hers; her pre-122 line goes by the role now. Dee was demoted earlier: her
// line stamped true (written while she was the studio) stays the studio's.
await insertLines(db, [{ ...base, creator_id: 'user_dee', kind: 'member_share', cents: 999, studio: true }]);
const unpaid = (await db.query("select id, creator_id, cents, created_at, studio from creator_ledger where lane = 'earnings' and payout_id is null order by created_at, id")).rows
  .map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
const owed = owedByStudio(unpaid, new Set(['user_mara', 'user_admin']));
const by = (id, studio) => owed.find((o) => o.creatorId === id && o.studio === studio);
// Mara's own: 175 − 175 + 175 (restore) + 40 (ad share) + 200 (pool) + 75 (payout reversal) = 490
assert.equal(by('user_mara', false).cents, 490);
// Mara's pre-122 line (100), its reversal (−100) and restore (+100), by the role now: kept.
assert.equal(by('user_mara', true).cents, 100);
// Dee: referral 150 − 150 + 150, cancelled −50, ad share 30, pool 100 = 230 own; 999 kept from her team days.
assert.equal(by('user_dee', false).cents, 230);
assert.equal(by('user_dee', true).cents, 999);
assert.equal(by('user_admin', true).cents, 175);
assert.equal(by('user_admin', false), undefined);
const ready = { stripeAccountId: 'acct', chargesEnabled: true };
const plan = planPayouts({ owed, accounts: { user_mara: ready, user_dee: ready, user_admin: ready }, minimumCents: 100 });
assert.deepEqual(plan.pay.map((p) => [p.creatorId, p.cents]).sort(), [['user_dee', 230], ['user_mara', 490]]);
assert.deepEqual(plan.kept.map((k) => [k.creatorId, k.cents]).sort(), [['user_admin', 175], ['user_dee', 999], ['user_mara', 100]]);
// The claim the batch makes takes only the account's own lines.
const maraOwn = by('user_mara', false);
const claimed = await db.query('update creator_ledger set payout_id = $1 where id = any($2) and payout_id is null returning id', [payout.id, maraOwn.lineIds]);
assert.equal(claimed.rows.length, maraOwn.lineIds.length);
assert.equal((await db.query("select count(*)::int c from creator_ledger where creator_id = 'user_mara' and payout_id is null and studio is distinct from false")).rows[0].c, 3);
ok('the owed split on the real rows: a promoted creator is paid her own credits, a demoted one never the studio’s, and a claim takes only the account’s own lines');

// --- the catch-up's claim on an unfinished stripe_events row.
await db.query("insert into stripe_events (id, type, received_at) values ('evt_dead', 'invoice.paid', now() - interval '1 hour'), ('evt_done', 'invoice.paid', now() - interval '1 hour')");
await db.query("update stripe_events set processed_at = now() where id = 'evt_done'");
const listed = (await db.query(`select id, to_json(received_at)#>>'{}' as received_at from stripe_events
  where processed_at is null and received_at < now() - interval '10 minutes' and received_at >= now() - interval '30 days' order by received_at`)).rows;
assert.deepEqual(listed.map((r) => r.id), ['evt_dead']);
const claim = (id, at) => db.query("update stripe_events set received_at = now() where id = $1 and received_at = $2 and processed_at is null returning id", [id, at]);
assert.equal((await claim('evt_dead', listed[0].received_at)).rows.length, 1);
assert.equal((await claim('evt_dead', listed[0].received_at)).rows.length, 0);
const doneAt = (await db.query("select to_json(received_at)#>>'{}' as at from stripe_events where id = 'evt_done'")).rows[0].at;
assert.equal((await claim('evt_done', doneAt)).rows.length, 0);
ok('the catch-up’s list finds the unfinished row only; its claim (PostgREST’s ISO time back as the filter) wins once, never on a finished row');

// member_payments by invoice id (what the invoice step compares against).
const have = (await db.query("select stripe_invoice_id from member_payments where stripe_invoice_id = any($1)", [['in_rig1', 'in_missing']])).rows.map((r) => r.stripe_invoice_id);
assert.deepEqual(have, ['in_rig1']);
ok('the invoice step’s read: which invoice ids member_payments has');

console.log(`\n${n} passed`);
