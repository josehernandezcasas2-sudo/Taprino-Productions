// Writes the rig's seed into the database and the storage stand-in.
// Idempotent: every row is an upsert on its primary key (or unique key),
// so running it twice changes nothing. Only columns the database has are
// written — with RIG_MIGRATE_TO the chain stops early and a later
// migration's columns (or tables) are left out, with a note.
import fs from 'node:fs';
import path from 'node:path';
import { RIG_DIR } from './config.mjs';
import { psqlExec, psqlRows } from './pg.mjs';
import { catalogue } from '../seed/catalogue.mjs';
import { ensureBucket, putObject } from './storage.mjs';
import { jpegCard } from './images.mjs';

const ACCOUNTS = path.join(RIG_DIR, 'seed', 'accounts.json');

function tableInfo() {
  const cols = psqlRows("select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'");
  const byTable = {};
  for (const r of cols) (byTable[r.t] = byTable[r.t] || new Set()).add(r.c);
  return byTable;
}

const TAG = '$rigjson$';

// INSERT … SELECT … FROM json_populate_recordset: Postgres does the type
// conversion (jsonb, text[], timestamptz) and the real constraints apply.
function upsertSql(table, rows, cols, conflict, { update = true } = {}) {
  const list = cols.map((c) => `"${c}"`).join(', ');
  const json = JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]]))));
  if (json.includes(TAG)) throw new Error('seed data contains the dollar-quote tag');
  const sets = cols.filter((c) => !conflict.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const onConflict = update && sets ? `on conflict (${conflict.map((c) => `"${c}"`).join(', ')}) do update set ${sets}` : `on conflict (${conflict.map((c) => `"${c}"`).join(', ')}) do nothing`;
  return `insert into public."${table}" (${list}) select ${list} from json_populate_recordset(null::public."${table}", ${TAG}${json}${TAG}) ${onConflict};`;
}

export async function seed({ base, code = 'test', log = console.log } = {}) {
  const info = tableInfo();
  const notes = [];
  const statements = [];

  const write = (table, rows, conflict, opts) => {
    if (!rows.length) return;
    const have = info[table];
    if (!have) {
      notes.push(`skipped ${table}: the table is not in this database`);
      return;
    }
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const missing = keys.filter((k) => !have.has(k));
    if (missing.length) notes.push(`${table}: left out ${missing.join(', ')} (not in this database)`);
    if (!conflict.every((c) => have.has(c))) {
      notes.push(`skipped ${table}: its key ${conflict.join(', ')} is not in this database`);
      return;
    }
    // One statement per shape of row: a column a row doesn't name keeps
    // its default rather than being written as null.
    const groups = new Map();
    for (const r of rows) {
      const cols = Object.keys(r).filter((k) => have.has(k)).sort();
      const sig = cols.join(',');
      if (!groups.has(sig)) groups.set(sig, { cols, rows: [] });
      groups.get(sig).rows.push(r);
    }
    for (const g of groups.values()) statements.push(upsertSql(table, g.rows, g.cols, conflict, opts));
  };

  // site_settings row 1 and the ratings the chain normally brings.
  if (info.site_settings) statements.push('insert into public.site_settings (id) values (1) on conflict (id) do nothing;');
  if (info.content_ratings) {
    const n = psqlRows('select count(*)::int as n from public.content_ratings')[0].n;
    if (n === 0) {
      const ratings = [
        ['G', 'General audiences', 0], ['PG', 'Parental guidance suggested', 0], ['PG-13', 'Parents strongly cautioned', 13], ['R', 'Restricted', 17], ['NC-17', 'Adults only', 18],
        ['TV-Y', 'All children', 0], ['TV-Y7', 'Directed to older children', 7], ['TV-G', 'General audience', 0], ['TV-PG', 'Parental guidance suggested', 0], ['TV-14', 'Parents strongly cautioned', 14], ['TV-MA', 'Mature audience only', 17]
      ].map(([code_, label, min], i) => ({ code: code_, label, min_age: min, sort: (i + 1) * 10, is_custom: false }));
      write('content_ratings', ratings, ['code'], { update: false });
    }
  }

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8')).accounts;
  write('user_profiles', accounts.map((a) => ({ user_id: a.id, ...a.profile })), ['user_id']);

  const cat = catalogue({ base, code });
  write('series', cat.series, ['id']);
  write('episodes', cat.episodes, ['id']);
  write('creator_payout_accounts', cat.payoutAccounts, ['user_id']);
  write('title_prices', cat.prices, ['target_type', 'target_id']);

  const sql = `begin;\n${statements.join('\n')}\ncommit;`;
  const res = psqlExec(sql);
  if (!res.ok) throw new Error(`seed failed: ${res.stderr.trim()}`);

  // The pictures, drawn once per key.
  ensureBucket('episode-art', { public: true, fileSizeLimit: 6 * 1024 * 1024 });
  for (const pic of cat.pictures) {
    const data = await jpegCard({ width: pic.width, height: pic.height, title: pic.title });
    putObject(pic.bucket, pic.key, data, { contentType: 'image/jpeg', cacheControl: 'max-age=3600' });
  }

  for (const n of notes) log(`seed note: ${n}`);
  log(`seeded ${accounts.length} accounts, ${cat.series.length} shows, ${cat.episodes.length} titles, ${cat.pictures.length} pictures`);
  return { notes };
}
