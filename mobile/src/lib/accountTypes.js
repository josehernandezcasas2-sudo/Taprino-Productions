import { apiGet, apiPost, freshToken } from './api';
import { makeMain } from './accountTypeRules';
import { currentRole, setRoleAccountTypes } from './adminRole';

// Account types (Jose, 2026-11-18; migration 126): the app's reads and
// writes of /api/account/types. Every word and rule is in
// lib/accountTypeRules.js (the website's file word for word); this file
// only talks to the route and keeps the ☰ menu's copy (the /api/my-role
// answer in lib/adminRole.js) in step with what was saved.
//
//   GET  → { types, main, asked, watcher, available, suggested, isCreator }
//          (available: false before 126; a 200 either way)
//   POST { types, main } or { skip: true } → the saved state; 503
//          { code: 'migration-126' } before 126, 401 signed out, 429 past
//          60 saves an hour.

// The person's own state, or throws (the error carries `status`).
export async function readAccountTypes(getToken) {
  const token = await freshToken(getToken);
  if (!token) {
    const err = new Error('Not signed in.');
    err.status = 401;
    throw err;
  }
  return apiGet('/api/account/types', token);
}

// What the menu's copy holds: the types, the main and whether it was asked.
function forMenu(state) {
  return { types: Array.isArray(state.types) ? state.types : [], main: state.main || null, asked: state.asked !== false };
}

// Saves { types, main } or { skip: true } → the saved state, and hands it
// to the ☰ menu. Throws as readAccountTypes does.
export async function saveAccountTypes(getToken, body) {
  const token = await freshToken(getToken);
  if (!token) {
    const err = new Error('Not signed in.');
    err.status = 401;
    throw err;
  }
  const saved = await apiPost('/api/account/types', body, token);
  setRoleAccountTypes(forMenu(saved));
  return saved;
}

// The ☰ menu's chips: the main changes at once in the menu's copy, the
// save follows, and a failure puts the old state back (and throws).
export async function switchMainType(getToken, state, type) {
  const before = state;
  const next = makeMain(state, type);
  setRoleAccountTypes({ ...forMenu(before), types: next.types, main: next.main });
  try {
    return await saveAccountTypes(getToken, { types: next.types, main: next.main });
  } catch (err) {
    const role = currentRole();
    // Only put it back when nothing newer landed meanwhile.
    if (role && role.accountTypes && role.accountTypes.main === next.main) setRoleAccountTypes(forMenu(before));
    throw err;
  }
}

// Before 126 a save answers 503 { code: 'migration-126' }.
export function isNotReady(err) {
  return Boolean(err && err.status === 503);
}
