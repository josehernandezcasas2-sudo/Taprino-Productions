// Migrations are run by hand in the Supabase SQL Editor, so the code is
// often a step ahead of the database. A write that only adds optional
// columns from a newer migration must not break the older feature it
// rides on: posting a call worked before migration 104/105 added
// production_id and urgent, and must keep working until they're run.
// These retry a write without the optional keys when Postgres says one
// of them doesn't exist. (notify.js does the same for notifications.href.)

const mentions = (error, keys) => Boolean(error) && keys.some((k) => new RegExp(`\\b${k}\\b`).test(error.message || ''));
const without = (row, keys) => {
  const slim = { ...row };
  for (const k of keys) delete slim[k];
  return slim;
};

export async function insertCompat(supabase, table, row, optionalKeys, { select = '*' } = {}) {
  let res = await supabase.from(table).insert(row).select(select).single();
  if (res.error && mentions(res.error, optionalKeys)) res = await supabase.from(table).insert(without(row, optionalKeys)).select(select).single();
  return res;
}

// `where(q)` applies the filters, e.g. (q) => q.eq('id', id).
export async function updateCompat(supabase, table, patch, optionalKeys, where) {
  let res = await where(supabase.from(table).update(patch));
  if (res.error && mentions(res.error, optionalKeys)) res = await where(supabase.from(table).update(without(patch, optionalKeys)));
  return res;
}

// The same for writes and reads on money tables (migration 122's
// creator_ledger.studio): stricter about what counts as "the column isn't
// there" — PostgREST's PGRST204 (a column it doesn't know on a write),
// Postgres's 42703 (undefined_column, on a read), or a message about a
// column — so a different error that happens to name the word is never
// answered by quietly dropping the field.
const missingColumn = (error, keys) => Boolean(error)
  && (error.code === 'PGRST204' || error.code === '42703' || /\bcolumn\b/i.test(error.message || ''))
  && mentions(error, keys);

// Several rows in one insert (one statement: all or none).
export async function insertManyCompat(supabase, table, rows, optionalKeys) {
  if (!rows || rows.length === 0) return { error: null, data: null };
  let res = await supabase.from(table).insert(rows);
  if (res.error && missingColumn(res.error, optionalKeys)) res = await supabase.from(table).insert(rows.map((r) => without(r, optionalKeys)));
  return res;
}

// A read naming columns a newer migration adds: `build(columns)` makes the
// query; without the optional columns when the database doesn't have them.
export async function selectCompat(build, columns, optionalColumns) {
  let res = await build([columns, ...optionalColumns].join(', '));
  if (res.error && missingColumn(res.error, optionalColumns)) res = await build(columns);
  return res;
}
