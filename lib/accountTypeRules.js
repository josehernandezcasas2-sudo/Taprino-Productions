// Account types (Jose, 2026-11-18; migration 126; the canvas
// https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q). A person ticks any of
// Creator, Crew, Cast and Studio; one of them is their main, which decides
// what people see first on their profile and what they see first in the
// menu. None ticked = here to watch, which is also what skipping the
// sign-up question leaves. A type is a label and an order: it never grants
// anything (uploading still needs the creator role, an approved
// application) and no paid plan reads it yet.
//
// Pure, no imports. The app's mobile/src/lib/accountTypeRules.js is this
// file word for word (node scripts/test-account-types.mjs checks it). Every
// label, line and order about account types is built here, never in a
// component or a screen.

export const ACCOUNT_TYPES = ['creator', 'crew', 'cast', 'studio'];

export const TYPE_LABELS = {
  creator: 'Creator',
  crew: 'Crew',
  cast: 'Cast',
  studio: 'Studio'
};

// The sign-up question's cards.
export const TYPE_BLURBS = {
  creator: 'Put your films and shows on Stream, pitch projects, get paid',
  crew: 'Find work on sets; a working card with your roles and gear',
  cast: 'Act, host or perform; headshots, reel and casting calls',
  studio: 'An organization: post calls as the company, book places, run productions'
};

// The Your types sheet's rows.
export const TYPE_SHEET_LINES = {
  creator: 'Your titles and pitches; the Dashboard tab',
  crew: 'Working card and gear; Calls',
  cast: 'Headshots, playing age, reel; casting calls',
  studio: 'An organization’s page: productions, open calls'
};

export const TYPE_WORDS = {
  askTitle: 'What brings you here?',
  askIntro: 'Pick all that fit. The first one is your main: it’s what people see first on your profile. Change it any time.',
  askSkipNote: 'Here to watch? Skip: you start as a viewer and can add a type later from your profile.',
  skip: 'Skip',
  pick: 'Pick',
  skipLong: 'Skip, I’m here to watch',
  pickOne: 'Pick one, or skip',
  main: 'Main',
  mainChip: 'MAIN',
  makeMain: 'Make main',
  sheetTitle: 'Your types',
  sheetIntro: 'Tick all that fit. Your main is what people see first on your profile, and what you see first here.',
  sheetNote: 'Unticking a type only hides it from your profile: your cards, gear and credits stay. None ticked means you’re here to watch.',
  rowLabel: 'Your types',
  change: 'Change',
  watcher: 'Here to watch',
  menuMain: 'Your main',
  addType: '+ Add a type',
  menuSwitchNote: 'Switching your main changes what people see first. Your other types stay.',
  creatorNeedsApply: 'Uploading titles still needs an approved creator application.',
  applyLink: 'Apply to put your work on Stream ›',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  close: 'Close',
  failed: 'Couldn’t save your types. Try again.',
  notReady: 'Account types need a database update first (migration 126).'
};

// Where the Your types sheet lives (the menu's "+ Add a type" opens it).
export const TYPES_HREF = '/account/profile#types';
// The sign-up question.
export const ASK_PATH = '/start';

export function isAccountType(value) {
  return typeof value === 'string' && ACCOUNT_TYPES.includes(value);
}

// Only the four types, each once, in the order given.
export function normalizeTypes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (isAccountType(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

// The main is one of the ticked types; with none named, the first one.
export function normalizeMain(types, main) {
  const list = normalizeTypes(types);
  if (isAccountType(main) && list.includes(main)) return main;
  return list[0] || null;
}

// The main first, then the others in the usual order.
export function orderedTypes(types, main) {
  const list = normalizeTypes(types);
  const first = normalizeMain(list, main);
  if (!first) return [];
  return [first, ...ACCOUNT_TYPES.filter((t) => t !== first && list.includes(t))];
}

// What a person's row (the database's names or the API's) says.
// available: false when the database hasn't the columns yet (before 126).
export function typeState(row) {
  if (!row || typeof row !== 'object') return { types: [], main: null, asked: false, watcher: true, available: true };
  const rawTypes = row.types !== undefined ? row.types : row.account_types;
  const rawMain = row.main !== undefined ? row.main : row.main_type;
  const askedAt = row.askedAt !== undefined ? row.askedAt : row.account_type_asked_at;
  const types = orderedTypes(rawTypes, rawMain);
  return {
    types,
    main: types[0] || null,
    asked: Boolean(askedAt),
    watcher: types.length === 0,
    available: row.available !== false
  };
}

// "Crew", "Crew · also Cast", "Crew · also Cast and Studio".
export function typesLine(types, main) {
  const list = orderedTypes(types, main);
  if (list.length === 0) return '';
  const labels = list.map((t) => TYPE_LABELS[t]);
  if (labels.length === 1) return labels[0];
  const rest = labels.slice(1);
  const tail = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]}`;
  return `${labels[0]} · also ${tail}`;
}

// The sign-up question's button.
export function continueLabel(types, main) {
  const list = orderedTypes(types, main);
  if (list.length === 0) return TYPE_WORDS.pickOne;
  return `Continue as ${list.map((t) => TYPE_LABELS[t]).join(' + ')}`;
}

// Ticking or unticking a type. The first one ticked becomes the main;
// unticking the main hands it to the next one.
export function toggleType(state, type) {
  const types = normalizeTypes(state && state.types);
  const main = normalizeMain(types, state && state.main);
  if (!isAccountType(type)) return { types, main };
  if (types.includes(type)) {
    const left = types.filter((t) => t !== type);
    const nextMain = main === type ? (ACCOUNT_TYPES.find((t) => left.includes(t)) || null) : main;
    return { types: left, main: normalizeMain(left, nextMain) };
  }
  const added = [...types, type];
  return { types: added, main: normalizeMain(added, main || type) };
}

export function makeMain(state, type) {
  const types = normalizeTypes(state && state.types);
  return { types, main: normalizeMain(types, types.includes(type) ? type : state && state.main) };
}

// Whether the sign-up question comes up: signed in, the database ready,
// never answered or skipped, and no type ticked some other way.
export function askDue({ signedIn = false, state = null } = {}) {
  if (!signedIn || !state || state.available === false) return false;
  return !state.asked && state.types.length === 0;
}

// What the sign-up question ticks to begin with, from what the person
// already has on the site (never saved until they press Continue).
export function suggestTypes({ isCreator = false, hasCrewCard = false, isPerformer = false, hasStudio = false } = {}) {
  const out = [];
  if (isCreator) out.push('creator');
  if (hasCrewCard) out.push('crew');
  if (isPerformer) out.push('cast');
  if (hasStudio) out.push('studio');
  return out;
}

// The sheet's rows: each type, ticked or not, which is the main, and the
// creator note when Creator is ticked by someone without the role.
export function sheetRows(state, { isCreator = false } = {}) {
  const types = normalizeTypes(state && state.types);
  const main = normalizeMain(types, state && state.main);
  return ACCOUNT_TYPES.map((t) => ({
    type: t,
    label: TYPE_LABELS[t],
    line: TYPE_SHEET_LINES[t],
    checked: types.includes(t),
    main: main === t,
    canMakeMain: types.includes(t) && main !== t && types.length > 1,
    note: t === 'creator' && types.includes('creator') && !isCreator ? { text: TYPE_WORDS.creatorNeedsApply, href: '/apply', link: TYPE_WORDS.applyLink } : null
  }));
}

// The sign-up question's cards.
export function askCards(state) {
  const types = normalizeTypes(state && state.types);
  const main = normalizeMain(types, state && state.main);
  return ACCOUNT_TYPES.map((t) => ({
    type: t,
    label: TYPE_LABELS[t],
    blurb: TYPE_BLURBS[t],
    checked: types.includes(t),
    main: main === t && types.length > 0
  }));
}

// The ☰ menu's you card: the line under the name, the main chips (only
// with two or more types: switching needs somewhere to go) and the link to
// the sheet.
export function menuTypes(state) {
  const s = state && Array.isArray(state.types) ? state : typeState(state);
  if (s.available === false) return null;
  const list = orderedTypes(s.types, s.main);
  return {
    line: list.length ? typesLine(list, list[0]) : '',
    chips: list.length > 1 ? ACCOUNT_TYPES.filter((t) => list.includes(t)).map((t) => ({ type: t, label: TYPE_LABELS[t], main: t === list[0] })) : [],
    label: TYPE_WORDS.menuMain,
    note: list.length > 1 ? TYPE_WORDS.menuSwitchNote : '',
    add: list.length < ACCOUNT_TYPES.length ? { href: TYPES_HREF, label: TYPE_WORDS.addType } : null
  };
}

// The Account → Profile row.
export function typesRow(state) {
  const s = state && Array.isArray(state.types) ? state : typeState(state);
  return {
    label: TYPE_WORDS.rowLabel,
    value: s.types.length ? typesLine(s.types, s.main) : TYPE_WORDS.watcher,
    action: TYPE_WORDS.change,
    disabled: s.available === false,
    note: s.available === false ? TYPE_WORDS.notReady : ''
  };
}

// The profile's sections, the main's first. Each screen names its own
// sections with these keys (the website's ids and the app's differ):
//   about · card (working / performer card) · record (track record) ·
//   work (titles, "Tagged in") · pitches · places (Locations) · posts
// About stays at the top; the main's keys come next in this order; the
// rest keep their order.
export const MAIN_SECTION_KEYS = {
  creator: ['work', 'pitches'],
  crew: ['card', 'record'],
  cast: ['card', 'record'],
  studio: ['places', 'work']
};

export function mainFirst(items, main, keyOf = (item) => item && item.key) {
  const list = Array.isArray(items) ? items.slice() : [];
  const keys = MAIN_SECTION_KEYS[main] || [];
  if (keys.length === 0) return list;
  const top = list.filter((item) => keyOf(item) === 'about');
  const lead = keys.flatMap((k) => list.filter((item) => keyOf(item) === k));
  const rest = list.filter((item) => !top.includes(item) && !lead.includes(item));
  return [...top, ...lead, ...rest];
}

// What the save route takes: { types, main } or { skip: true }. Answers
// the clean values, or an error line.
export function validateTypesInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Send the types you picked, or skip.' };
  if (body.skip === true) return { types: [], main: null, skip: true };
  if (!Array.isArray(body.types)) return { error: 'Send the types you picked, or skip.' };
  if (body.types.some((t) => !isAccountType(t))) return { error: 'One of those isn’t an account type.' };
  const types = normalizeTypes(body.types);
  if (body.main != null && !types.includes(body.main)) return { error: 'Your main has to be one of the types you picked.' };
  return { types: orderedTypes(types, body.main), main: normalizeMain(types, body.main), skip: false };
}
