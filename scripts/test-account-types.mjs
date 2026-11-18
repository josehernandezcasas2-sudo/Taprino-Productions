// Account types (migration 126): lib/accountTypeRules.js, and the app's
// mobile/src/lib/accountTypeRules.js word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/accountTypeRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/accountTypeRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/accountTypeRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('normalizeTypes keeps the four types once each, in the order given', () => {
  assert.deepEqual(R.normalizeTypes(['cast', 'crew', 'cast', 'admin', 3, null]), ['cast', 'crew']);
  assert.deepEqual(R.normalizeTypes('crew'), []);
  assert.deepEqual(R.normalizeTypes(['constructor', '__proto__']), []);
});

t('the main is one of the types, else the first; ordered puts it first', () => {
  assert.equal(R.normalizeMain(['crew', 'cast'], 'cast'), 'cast');
  assert.equal(R.normalizeMain(['crew', 'cast'], 'studio'), 'crew');
  assert.equal(R.normalizeMain([], 'crew'), null);
  assert.deepEqual(R.orderedTypes(['studio', 'cast', 'crew'], 'studio'), ['studio', 'crew', 'cast']);
});

t('typeState reads the database names and the API names', () => {
  assert.deepEqual(R.typeState({ account_types: ['cast', 'crew'], main_type: 'crew', account_type_asked_at: '2026-11-18T00:00:00Z' }), { types: ['crew', 'cast'], main: 'crew', asked: true, watcher: false, available: true });
  assert.deepEqual(R.typeState({ types: [], main: null, askedAt: null }), { types: [], main: null, asked: false, watcher: true, available: true });
  assert.equal(R.typeState({ available: false }).available, false);
  assert.equal(R.typeState(null).watcher, true);
});

t('the line under a name', () => {
  assert.equal(R.typesLine([], null), '');
  assert.equal(R.typesLine(['crew'], 'crew'), 'Crew');
  assert.equal(R.typesLine(['cast', 'crew'], 'crew'), 'Crew · also Cast');
  assert.equal(R.typesLine(['crew', 'cast', 'studio'], 'crew'), 'Crew · also Cast and Studio');
  assert.equal(R.typesLine(['creator', 'crew', 'cast', 'studio'], 'studio'), 'Studio · also Creator, Crew and Cast');
});

t('the sign-up button names the main first', () => {
  assert.equal(R.continueLabel([], null), 'Pick one, or skip');
  assert.equal(R.continueLabel(['cast', 'crew'], 'crew'), 'Continue as Crew + Cast');
});

t('ticking: the first one is the main; unticking the main hands it on', () => {
  let s = { types: [], main: null };
  s = R.toggleType(s, 'cast');
  assert.deepEqual(s, { types: ['cast'], main: 'cast' });
  s = R.toggleType(s, 'crew');
  assert.deepEqual(s, { types: ['cast', 'crew'], main: 'cast' });
  s = R.makeMain(s, 'crew');
  assert.equal(s.main, 'crew');
  s = R.toggleType(s, 'crew');
  assert.deepEqual(s, { types: ['cast'], main: 'cast' });
  s = R.toggleType(s, 'cast');
  assert.deepEqual(s, { types: [], main: null });
  assert.deepEqual(R.toggleType({ types: ['crew'], main: 'crew' }, 'nope'), { types: ['crew'], main: 'crew' });
  assert.equal(R.makeMain({ types: ['crew'], main: 'crew' }, 'cast').main, 'crew');
});

t('the question comes up once, only when nothing is ticked and the database is ready', () => {
  const fresh = R.typeState({ types: [], askedAt: null });
  assert.equal(R.askDue({ signedIn: true, state: fresh }), true);
  assert.equal(R.askDue({ signedIn: false, state: fresh }), false);
  assert.equal(R.askDue({ signedIn: true, state: R.typeState({ types: [], askedAt: '2026-11-18' }) }), false);
  assert.equal(R.askDue({ signedIn: true, state: R.typeState({ types: ['crew'], askedAt: null }) }), false);
  assert.equal(R.askDue({ signedIn: true, state: { ...fresh, available: false } }), false);
  assert.equal(R.askDue({ signedIn: true, state: null }), false);
});

t('suggestions come from what the person already has', () => {
  assert.deepEqual(R.suggestTypes({ isCreator: true, hasCrewCard: true, isPerformer: true }), ['creator', 'crew', 'cast']);
  assert.deepEqual(R.suggestTypes({}), []);
});

t('the sheet rows: ticked, main, make main, and the creator note', () => {
  const rows = R.sheetRows({ types: ['crew', 'creator'], main: 'crew' }, { isCreator: false });
  assert.deepEqual(rows.map((r) => r.type), ['creator', 'crew', 'cast', 'studio']);
  const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
  assert.equal(byType.crew.main, true);
  assert.equal(byType.crew.canMakeMain, false);
  assert.equal(byType.creator.canMakeMain, true);
  assert.equal(byType.cast.canMakeMain, false);
  assert.equal(byType.creator.note.href, '/apply');
  assert.equal(R.sheetRows({ types: ['creator'], main: 'creator' }, { isCreator: true })[0].note, null);
});

t('the menu card: chips only with two or more types; the add link until all four', () => {
  assert.deepEqual(R.menuTypes({ types: [], main: null }).chips, []);
  assert.equal(R.menuTypes({ types: [], main: null }).line, '');
  const two = R.menuTypes({ types: ['cast', 'crew'], main: 'crew' });
  assert.equal(two.line, 'Crew · also Cast');
  assert.deepEqual(two.chips, [{ type: 'crew', label: 'Crew', main: true }, { type: 'cast', label: 'Cast', main: false }]);
  assert.equal(two.add.href, '/account/profile#types');
  assert.equal(R.menuTypes({ types: ['creator', 'crew', 'cast', 'studio'], main: 'cast' }).add, null);
  assert.equal(R.menuTypes({ available: false }), null);
  assert.equal(R.menuTypes({ account_types: ['crew'], main_type: 'crew' }).line, 'Crew');
});

t('the Account → Profile row', () => {
  assert.equal(R.typesRow({ types: [], main: null }).value, 'Here to watch');
  assert.equal(R.typesRow({ types: ['crew', 'cast'], main: 'crew' }).value, 'Crew · also Cast');
  assert.equal(R.typesRow({ types: [], main: null, available: false }).disabled, true);
});

t('the main’s sections come right after About', () => {
  const items = ['about', 'card', 'record', 'places', 'posts', 'work', 'pitches'].map((key) => ({ key }));
  const keys = (list) => list.map((i) => i.key);
  assert.deepEqual(keys(R.mainFirst(items, 'creator')), ['about', 'work', 'pitches', 'card', 'record', 'places', 'posts']);
  assert.deepEqual(keys(R.mainFirst(items, 'crew')), ['about', 'card', 'record', 'places', 'posts', 'work', 'pitches']);
  assert.deepEqual(keys(R.mainFirst(items, 'studio')), ['about', 'places', 'work', 'card', 'record', 'posts', 'pitches']);
  assert.deepEqual(keys(R.mainFirst(items, null)), keys(items));
  assert.deepEqual(R.mainFirst([{ id: 'x' }, { id: 'card' }, { id: 'about' }], 'crew', (i) => i.id).map((i) => i.id), ['about', 'card', 'x']);
});

t('what the save route takes', () => {
  assert.deepEqual(R.validateTypesInput({ skip: true }), { types: [], main: null, skip: true });
  assert.deepEqual(R.validateTypesInput({ types: ['cast', 'crew'], main: 'crew' }), { types: ['crew', 'cast'], main: 'crew', skip: false });
  assert.deepEqual(R.validateTypesInput({ types: [] }), { types: [], main: null, skip: false });
  assert.ok(R.validateTypesInput({ types: ['crew', 'admin'] }).error);
  assert.ok(R.validateTypesInput({ types: ['crew'], main: 'cast' }).error);
  assert.ok(R.validateTypesInput({}).error);
  assert.ok(R.validateTypesInput(null).error);
});

console.log(`${n} checks passed`);
