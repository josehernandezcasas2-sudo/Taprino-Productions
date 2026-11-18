import { getSupabase } from './supabase';
import { typeState, validateTypesInput, suggestTypes } from './accountTypeRules';

// Account types (migration 126): which of Creator, Crew, Cast and Studio a
// person ticked, and their main. The rules and every word are in
// lib/accountTypeRules.js; this file only reads and writes the three
// user_profiles columns.
//
// A database without 126 reads as `available: false` (the question never
// comes up, the sheet is greyed) and a save answers 503 `migration-126`.

const COLUMNS = 'account_types, main_type, account_type_asked_at';

function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /(account_types|main_type|account_type_asked_at).*(does not exist|column)|could not find the .*(account_types|main_type|account_type_asked_at)/i.test(error.message || '');
}

function notReady() {
  const err = new Error('Account types need a database update first (migration 126).');
  err.status = 503;
  err.code = 'migration-126';
  return err;
}

// The person's own state. { strict } throws on a failed read (the save path
// and the sign-in landing want to know); otherwise a failed read is logged
// and answers "not available", which only hides the question and the row.
export async function readAccountTypes(userId, { strict = false } = {}) {
  if (!userId) return typeState(null);
  const { data, error } = await getSupabase().from('user_profiles').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (isMissingColumn(error)) return { ...typeState(null), available: false };
  if (error) {
    if (strict) throw Object.assign(new Error('readAccountTypes failed'), { cause: error });
    console.error('readAccountTypes:', error.message);
    return { ...typeState(null), available: false };
  }
  return typeState(data);
}

// The same from a row already in hand (getOwnProfile selects every column):
// a row read before 126 has no account_types key at all.
export function accountTypesFromRow(row) {
  if (row && typeof row === 'object' && !('account_types' in row)) return { ...typeState(null), available: false };
  return typeState(row);
}

// What other people see: the types and the main, nothing else.
export async function readPublicAccountTypes(userId) {
  const s = await readAccountTypes(userId);
  return { types: s.types, main: s.main };
}

// Save the picked types (or a skip). Every save stamps the question as
// answered, so it never comes up again.
export async function saveAccountTypes(userId, body) {
  const input = validateTypesInput(body);
  if (input.error) throw Object.assign(new Error(input.error), { status: 400 });
  const now = new Date().toISOString();
  const row = { user_id: userId, account_types: input.types, main_type: input.main, account_type_asked_at: now, updated_at: now };
  const { error } = await getSupabase().from('user_profiles').upsert(row, { onConflict: 'user_id' });
  if (isMissingColumn(error)) throw notReady();
  if (error) {
    console.error('saveAccountTypes:', error.message);
    throw Object.assign(new Error('Couldn’t save your types. Try again.'), { status: 500 });
  }
  return typeState({ types: input.types, main: input.main, askedAt: now });
}

// What the sign-up question ticks to begin with: the creator role, a
// working card with roles, a performer card.
export async function suggestedTypesFor(userId, { isCreator = false } = {}) {
  let hasCrewCard = false;
  let isPerformer = false;
  if (userId) {
    const { data, error } = await getSupabase().from('crew_cards').select('roles, performer').eq('user_id', userId).maybeSingle();
    if (error && !/performer/i.test(error.message || '')) console.error('suggestedTypesFor:', error.message);
    if (data) {
      hasCrewCard = Array.isArray(data.roles) && data.roles.length > 0;
      isPerformer = data.performer === true;
    }
  }
  return suggestTypes({ isCreator, hasCrewCard, isPerformer });
}
