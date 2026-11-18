// Migration 126 (account types) on a real Postgres: builds the database
// through 125, checks the columns aren't there, seeds a profile, runs 126,
// then checks the columns, their defaults and comments, that the checks
// refuse what they should, that the site's write goes in (an upsert with
// only user_id and the three columns, as lib/accountTypes.js sends), and
// that a second run changes nothing.
// Needs PGlite (see scripts/pg-chain.mjs): node scripts/check-migration-126.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDb, migrationFiles, SUPABASE_DIR } from './pg-chain.mjs';

let n = 0;
const ok = (name) => { n += 1; console.log('ok', name); };

const FILE = migrationFiles().find((f) => f.startsWith('126_'));
assert.ok(FILE, 'supabase/migrations/126_*.sql exists');
const SQL = fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', FILE), 'utf8');
assert.doesNotMatch(SQL, /create table/i, 'columns only: no new table (so no row level security line is owed)');

const col = async (db, column) => (await db.query(`select data_type, is_nullable, column_default,
    col_description('public.user_profiles'::regclass, ordinal_position) as note
  from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = $1`, [column])).rows[0] || null;
const refused = async (db, sql, params, code, why) => {
  let err = null;
  try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `${why}: expected an error`);
  assert.equal(err.code, code, `${why}: ${err.message}`);
};

const db = await buildDb(125);
for (const c of ['account_types', 'main_type', 'account_type_asked_at']) assert.equal(await col(db, c), null, `${c} isn't there before 126`);
ok('none of 126’s columns exist before it runs');

await db.query(`insert into public.user_profiles (user_id, display_name) values ('user_m126old', 'Old Profile')`);
ok('a profile from before 126');

await db.exec(SQL);
ok('126 runs on a database through 125');

const types = await col(db, 'account_types');
assert.equal(types.data_type, 'ARRAY');
assert.equal(types.is_nullable, 'NO');
assert.match(types.column_default, /'\{\}'/);
assert.match(types.note, /Migration 126/);
assert.equal((await col(db, 'main_type')).data_type, 'text');
assert.equal((await col(db, 'account_type_asked_at')).data_type, 'timestamp with time zone');
for (const c of ['main_type', 'account_type_asked_at']) assert.match((await col(db, c)).note, /Migration 126/);
ok('the three columns, their types, default and comments');

const old = (await db.query(`select account_types, main_type, account_type_asked_at from public.user_profiles where user_id = 'user_m126old'`)).rows[0];
assert.deepEqual(old.account_types, []);
assert.equal(old.main_type, null);
assert.equal(old.account_type_asked_at, null);
ok('an existing profile reads as here to watch, never asked');

await db.query(`insert into public.user_profiles (user_id, account_types, main_type, account_type_asked_at, updated_at)
  values ('user_m126new', '{crew,cast}', 'crew', now(), now())
  on conflict (user_id) do update set account_types = excluded.account_types, main_type = excluded.main_type, account_type_asked_at = excluded.account_type_asked_at, updated_at = excluded.updated_at`);
await db.query(`insert into public.user_profiles (user_id, account_types, main_type, account_type_asked_at, updated_at)
  values ('user_m126old', '{}', null, now(), now())
  on conflict (user_id) do update set account_types = excluded.account_types, main_type = excluded.main_type, account_type_asked_at = excluded.account_type_asked_at, updated_at = excluded.updated_at`);
const kept = (await db.query(`select display_name, account_type_asked_at from public.user_profiles where user_id = 'user_m126old'`)).rows[0];
assert.equal(kept.display_name, 'Old Profile');
assert.ok(kept.account_type_asked_at);
ok('the site’s upsert: a new row with two types, and a skip on an existing row that keeps its name');

await refused(db, `update public.user_profiles set account_types = '{crew,admin}' where user_id = 'user_m126new'`, [], '23514', 'an unknown type');
await refused(db, `update public.user_profiles set main_type = 'studio' where user_id = 'user_m126new'`, [], '23514', 'a main that isn’t ticked');
await refused(db, `update public.user_profiles set account_types = '{crew,cast,studio,creator,crew}' where user_id = 'user_m126new'`, [], '23514', 'more than four');
await refused(db, `update public.user_profiles set account_types = '{}' where user_id = 'user_m126new'`, [], '23514', 'unticking every type while a main is set');
await db.query(`update public.user_profiles set account_types = '{}', main_type = null where user_id = 'user_m126new'`);
ok('the checks refuse an unknown type, a main that isn’t ticked, more than four, and a main left behind');

const before = (await db.query(`select count(*)::int as n from pg_constraint where conname like 'user_profiles_%type%check'`)).rows[0].n;
await db.exec(SQL);
const after = (await db.query(`select count(*)::int as n from pg_constraint where conname like 'user_profiles_%type%check'`)).rows[0].n;
assert.equal(after, before);
assert.equal(after, 2);
ok('a second run changes nothing');

console.log(`${n} checks passed`);
