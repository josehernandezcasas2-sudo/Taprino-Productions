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
