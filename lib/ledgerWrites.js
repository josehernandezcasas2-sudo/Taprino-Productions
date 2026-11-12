import { getSupabase } from './supabase';
import { studioAccountsAmong } from './payees';
import { insertManyCompat, selectCompat } from './dbCompat';
import { stampLines } from './creatorShareRules';

// SERVER-ONLY. Every write of creator_ledger goes through here (migration
// 122): each line says, from the moment it is written, whether the account
// it credits or debits was the studio's own (a full admin) — `studio` true
// or false — so an account's role changing later never moves money already
// on the ledger (lib/creatorShareRules.js isStudioLine). The role is the
// strict read the money path already makes (lib/payees.js
// studioAccountsAmong: Clerk by id, a failure throws, so nothing is written
// on a guess). Before 122 the column isn't there and the lines are written
// without it, as they always were; a line read without it (or written
// before 122, null) is placed by the account's role now.

export const LEDGER_STUDIO = ['studio'];

const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

// Lines that don't say yet get the stamp from a role read of their
// accounts; a line that already says (a reversal inheriting its credit's,
// a payout line, the leaver's forfeit) keeps it. { strict: false } is only
// for display paths — every write uses the default.
export async function stampStudio(lines, { strict = true } = {}) {
  const need = [...new Set((lines || []).filter((l) => l && !has(l, 'studio')).map((l) => l.creator_id).filter(Boolean))];
  const studio = need.length ? await studioAccountsAmong(need, { strict }) : new Set();
  return stampLines(lines, studio);
}

// One insert (one statement: all the lines or none), with `studio` when the
// database has it. → { error }
export async function insertLedgerLines(lines, { supabase = getSupabase() } = {}) {
  return insertManyCompat(supabase, 'creator_ledger', lines || [], LEDGER_STUDIO);
}

// Stamps (strictly) and writes. → { error, lines }
export async function writeLedgerLines(lines, { supabase = getSupabase() } = {}) {
  const stamped = await stampStudio(lines);
  const { error } = await insertLedgerLines(stamped, { supabase });
  return { error, lines: stamped };
}

// A read of creator_ledger naming `columns`, with `studio` when the
// database has it. `build(columns)` makes the query.
export async function selectLedger(build, columns) {
  return selectCompat(build, columns, LEDGER_STUDIO);
}
