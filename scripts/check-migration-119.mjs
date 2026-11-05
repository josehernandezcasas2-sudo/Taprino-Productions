// Migration 119 (the security switches) on a real Postgres: builds the
// database from schema.sql and every migration through 118, runs 119,
// checks the five columns, their starting values and types, that the row
// the site reads (id = 1) carries them, that row level security is still
// on for site_settings, that the switches and the ticks write and read
// back the way lib/securityPage.js writes them, that the reader's rules
// (lib/securityRules.js) read the row as intended, and that a second run
// changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-119.mjs
import assert from 'node:assert/strict';
import { buildDb, runMigration } from './pg-chain.mjs';
import { effectiveSwitches, hasSecurityColumns, normalizeChecklist } from '../lib/securityRules.js';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const db = await buildDb(118);
ok('schema.sql + migrations 002–118 run on a fresh Postgres');

await db.query('insert into site_settings (id) values (1) on conflict (id) do nothing');
const before = (await db.query('select * from site_settings where id = 1')).rows[0];
assert.equal(hasSecurityColumns(before), false);
assert.equal(effectiveSwitches(before, {}).hidden, true, 'before 119 the code reads "kept out of search engines"');
assert.equal(effectiveSwitches(before, {}).doorShut, false);
ok('before 119 the row has no switch columns and reads as the starting values');

await runMigration(db, 119);
ok('119 runs');

const cols = (await db.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'site_settings'
    and column_name in ('private_beta','hide_from_search','block_ai_search','admin_require_2fa','security_checklist') order by column_name`)).rows;
assert.equal(cols.length, 5);
const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));
for (const c of ['private_beta', 'hide_from_search', 'block_ai_search', 'admin_require_2fa']) {
  assert.equal(by[c].data_type, 'boolean', c);
  assert.equal(by[c].is_nullable, 'NO', c);
}
assert.equal(by.security_checklist.data_type, 'jsonb');
ok('five columns, booleans and a jsonb, none nullable');

const row = (await db.query('select * from site_settings where id = 1')).rows[0];
assert.equal(row.private_beta, false);
assert.equal(row.hide_from_search, true);
assert.equal(row.block_ai_search, true);
assert.equal(row.admin_require_2fa, false);
assert.deepEqual(row.security_checklist, {});
assert.equal(hasSecurityColumns(row), true);
const eff = effectiveSwitches(row, {});
assert.deepEqual([eff.doorShut, eff.hidden, eff.aiSearchBlocked, eff.twoStepRequired], [false, true, true, false]);
ok('the existing row starts: door open, kept out of search engines, AI answer engines blocked, two-step not required');

const rls = (await db.query("select relrowsecurity from pg_class where relname = 'site_settings'")).rows[0];
assert.equal(rls.relrowsecurity, true);
ok('site_settings still has row level security on');

await db.query('update site_settings set private_beta = $1, hide_from_search = $2 where id = 1', [true, false]);
await db.query('update site_settings set security_checklist = $1 where id = 1', [JSON.stringify({ github: true, backups: true })]);
const after = (await db.query('select * from site_settings where id = 1')).rows[0];
const eff2 = effectiveSwitches(after, {});
assert.equal(eff2.doorShut, true);
assert.equal(eff2.hidden, true, 'the shut door keeps search engines out whatever the switch says');
assert.deepEqual(normalizeChecklist(after.security_checklist), { github: true, backups: true });
ok('the switches and the ticks write and read back as lib/securityPage.js writes them');

try {
  await db.query('update site_settings set private_beta = null where id = 1');
  throw new Error('a null switch was accepted');
} catch (err) {
  assert.match(err.message, /null value|violates not-null/i);
}
ok('a switch can’t be set to null');

await runMigration(db, 119);
const again = (await db.query('select private_beta, hide_from_search, security_checklist from site_settings where id = 1')).rows[0];
assert.equal(again.private_beta, true);
assert.equal(again.hide_from_search, false);
assert.deepEqual(again.security_checklist, { github: true, backups: true });
ok('a second run changes nothing');

console.log(`\n${n} passed`);
