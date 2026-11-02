// A real Postgres for checking migrations before they are handed over:
// builds an in-process database (PGlite, Postgres compiled to WebAssembly)
// from supabase/schema.sql and every numbered migration up to a given one,
// the way they are run in the Supabase SQL Editor (each file as one script,
// in order). The local stand-ins never enforce column types or constraints;
// this does (it caught nothing less than the uuid title columns of 097/103,
// fixed in 117).
//
// PGlite is not a dependency of the site. Once per checkout:
//   npm i --no-save @electric-sql/pglite@0.3.15
// Then a check script imports buildDb / runMigration from here, e.g.
//   node scripts/check-migration-117.mjs
// Not run in CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPABASE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

// gen_random_uuid() is in core Postgres since 13, so pgcrypto isn't needed
// (PGlite doesn't ship it); no migration uses its other functions.
const shim = (sql) => sql.replace(/create extension if not exists pgcrypto\s*;/gi, '-- pgcrypto: gen_random_uuid() is core');

export function migrationFiles() {
  return fs.readdirSync(path.join(SUPABASE_DIR, 'migrations'))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

async function loadPGlite() {
  try {
    return (await import('@electric-sql/pglite')).PGlite;
  } catch (err) {
    throw new Error('PGlite is not installed: run `npm i --no-save @electric-sql/pglite@0.3.15` first.');
  }
}

export async function runFile(db, file) {
  await db.exec(shim(fs.readFileSync(file, 'utf8')));
}

// schema.sql + migrations 002..upTo, on a fresh database.
export async function buildDb(upTo, { log = () => {} } = {}) {
  const PGlite = await loadPGlite();
  const db = new PGlite();
  // Supabase's roles, which migration 112 grants to and revokes from.
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await runFile(db, path.join(SUPABASE_DIR, 'schema.sql'));
  for (const f of migrationFiles()) {
    if (Number(f.slice(0, 3)) > upTo) break;
    try {
      await runFile(db, path.join(SUPABASE_DIR, 'migrations', f));
      log(`ran ${f}`);
    } catch (err) {
      throw new Error(`${f}: ${err.message}`);
    }
  }
  return db;
}

export async function runMigration(db, n) {
  const f = migrationFiles().find((x) => Number(x.slice(0, 3)) === n);
  if (!f) throw new Error(`no migration ${n}`);
  await runFile(db, path.join(SUPABASE_DIR, 'migrations', f));
  return f;
}
