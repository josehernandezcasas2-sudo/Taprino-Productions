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
  const state = await apiGet('/api/account/types', token);
  // Every read keeps the ☰ menu's copy current (2026-11-20 review: it was
  // read once a session, so a change made on the website was undone by the
  // next switch from the app's menu).
  if (state && state.available !== false) setRoleAccountTypes(forMenu(state));
  return state;
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
//
// The types sent are read fresh first, so a type added elsewhere since the
// menu's copy was read (on the website, another phone) is kept.
export async function switchMainType(getToken, state, type) {
  const before = state;
  const shown = makeMain(state, type);
  setRoleAccountTypes({ ...forMenu(before), types: shown.types, main: shown.main });
  try {
    const token = await freshToken(getToken);
    const fresh = token ? await apiGet('/api/account/types', token).catch(() => null) : null;
    const base = fresh && fresh.available !== false && Array.isArray(fresh.types) ? fresh : state;
    const next = makeMain(base, type);
    return await saveAccountTypes(getToken, { types: next.types, main: next.main });
  } catch (err) {
    const role = currentRole();
    // Only put it back when nothing newer landed meanwhile.
    if (role && role.accountTypes && role.accountTypes.main === shown.main) setRoleAccountTypes(forMenu(before));
    throw err;
  }
}

// Before 126 a save answers 503 { code: 'migration-126' }.
export function isNotReady(err) {
  return Boolean(err && err.status === 503);
}
