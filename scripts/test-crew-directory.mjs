// node scripts/test-crew-directory.mjs — Crew Call, simpler
// (lib/crewDirectoryRules.js, 2026-11-18): the four tabs with Calls first,
// the older links, the search placeholder, the place chip, the filters and
// the API query each tab reads, a person's row with its gear line (People
// B), a performer's row (Cast B), a call's row, a piece of gear, the empty
// lists and the "Free right now?" strip. The app's copy is checked word
// for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/crewDirectoryRules.js';
import { AVAILABLE_NOW_CHOICES } from '../lib/crewCallRules.js';
import { WITHIN_CHOICES } from '../lib/crewOptions.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const LA = { label: 'Los Angeles, California, United States', lat: 34.05, lng: -118.24 };

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/crewDirectoryRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/crewDirectoryRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('the choices match the site’s own lists', () => {
  assert.deepEqual(R.FREE_HOURS, AVAILABLE_NOW_CHOICES);
  assert.deepEqual(R.WITHIN_STEPS, WITHIN_CHOICES);
});

t('Calls is the first tab and the bare page; older links land where they meant', () => {
  assert.deepEqual(R.CREW_TABS, ['calls', 'people', 'cast', 'gear']);
  assert.equal(R.tabFromQuery({}), 'calls');
  assert.equal(R.tabFromQuery({ tab: 'gear' }), 'gear');
  assert.equal(R.tabFromQuery({ tab: ['cast'] }), 'cast');
  assert.equal(R.tabFromQuery({ tab: 'nonsense' }), 'calls');
  assert.equal(R.tabFromQuery({ free: '1' }), 'people');
  assert.equal(R.tabFromQuery({ urgent: '1' }), 'calls');
  assert.equal(R.tabHref('calls'), '/crew');
  assert.equal(R.tabHref('people'), '/crew?tab=people');
  const f = R.filtersFromQuery({ free: '1', urgent: '1', production: 'not-a-uuid', kind: 'cast' }, LA);
  assert.equal(f.free, true);
  assert.equal(f.urgent, true);
  assert.equal(f.production, '');
  assert.equal(f.kind, 'cast');
  assert.equal(f.within, 50);
  assert.equal(R.filtersFromQuery({ production: '0b5e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b' }).production, '0b5e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b');
});

t('the search says how many there are', () => {
  assert.equal(R.searchPlaceholder('calls', 12), 'Search 12 open calls…');
  assert.equal(R.searchPlaceholder('calls', 1), 'Search 1 open call…');
  assert.equal(R.searchPlaceholder('people', 24), 'Search 24 people…');
  assert.equal(R.searchPlaceholder('cast', 0), 'Search performers…');
  assert.equal(R.searchPlaceholder('gear', null), 'Search pieces of gear…');
  assert.equal(R.searchPlaceholder('gear', 63), 'Search 63 pieces of gear…');
});

t('the place chip says where and how it is sorted', () => {
  assert.deepEqual(R.placeChip(null, 0), { label: 'Anywhere · newest', on: false });
  assert.deepEqual(R.placeChip(LA, 50), { label: 'Los Angeles · 50 mi', on: true });
  assert.deepEqual(R.placeChip(LA, 0), { label: 'Los Angeles · any distance', on: true });
  assert.equal(R.withinLabel(0), 'Anywhere');
  assert.equal(R.withinLabel(25), '25 mi');
});

t('each tab reads its own API with its own filters', () => {
  const f = { ...R.emptyFilters(LA), q: ' gaffer ', roles: ['Gaffer', 'Grip'], callRole: 'Gaffer', pay: ['paid', 'union'], urgent: true, matches: true, free: true, ageMin: '25', ageMax: '', union: 'sag_aftra', gear: 'Lighting' };
  assert.equal(R.apiPathFor('calls', f), '/api/crew/calls?q=gaffer&lat=34.05&lng=-118.24&within=50&role=Gaffer&pay=paid%2Cunion&matches=1&urgent=1');
  assert.equal(R.apiPathFor('people', f), '/api/crew/people?q=gaffer&lat=34.05&lng=-118.24&within=50&roles=Gaffer%2CGrip&gear=Lighting&free=1');
  assert.equal(R.apiPathFor('cast', f), '/api/crew/people?cast=1&q=gaffer&lat=34.05&lng=-118.24&within=50&ageMin=25&union=sag_aftra&free=1');
  assert.equal(R.apiPathFor('gear', f), '/api/crew/people?view=gear&q=gaffer&lat=34.05&lng=-118.24&within=50&gear=Lighting');
  assert.equal(R.apiPathFor('calls', R.emptyFilters()), '/api/crew/calls');
  assert.equal(R.apiPathFor('people', R.emptyFilters()), '/api/crew/people');
});

t('the Filters chip counts a tab’s own filters; Clear all keeps the place', () => {
  const f = { ...R.emptyFilters(LA), roles: ['DP'], free: true, urgent: true, pay: ['paid'] };
  assert.equal(R.filterCount('people', f), 2);
  assert.equal(R.filtersLabel('people', f), 'Filters · 2');
  assert.equal(R.filterCount('calls', f), 2);
  assert.equal(R.filtersLabel('gear', f), 'Filters');
  const c = R.clearedFilters('people', { ...f, q: 'x' });
  assert.deepEqual(c.roles, []);
  assert.equal(c.free, false);
  assert.equal(c.q, '');
  assert.equal(c.near, LA);
  assert.equal(c.urgent, true, 'another tab’s filter stays');
});

t('a person’s row (People B): the mark, status, distance and rate, one gear line', () => {
  const until = new Date(2026, 10, 18, 18, 0).toISOString();
  const dee = R.personRow({ displayName: 'Dee Park', roles: ['Gaffer', 'Grip'], freeNow: true, availableNowUntil: until, availability: 'open', miles: 3, rateMin: 350, rateMax: 350, gear: [{ name: 'Aputure 600D Pro', flag: 'brings' }, { name: 'C-stands', flag: 'brings' }, { name: 'Flags', flag: 'brings' }, { name: 'Sandbags', flag: 'brings' }, { name: 'Dimmer', flag: 'brings' }] });
  assert.equal(dee.mark, 'free');
  assert.deepEqual(dee.status, { tone: 'free', text: '⚡ Free until 6 PM' });
  assert.equal(dee.roles, 'Gaffer · Grip');
  assert.equal(dee.meta, '3 mi · $350/day');
  assert.deepEqual(dee.gear, { verb: 'Brings', tone: 'brings', text: 'Aputure 600D Pro · C-stands +3' });
  const sam = R.personRow({ displayName: 'Sam', roles: ['DP', 'Camera operator', 'Editor', 'Colorist'], availability: 'booked', bookedUntil: '2026-12-02', place: 'Silver Lake, Los Angeles', rateMin: 600, rateMax: 800, gear: [{ name: 'Sony FX3 kit', flag: 'lends' }] });
  assert.equal(sam.mark, null);
  assert.deepEqual(sam.status, { tone: 'booked', text: 'Booked until Dec 2' });
  assert.equal(sam.roles, 'DP · Camera operator · Editor +1');
  assert.equal(sam.meta, 'Silver Lake · $600–800/day');
  assert.deepEqual(sam.gear, { verb: 'Lends', tone: 'lends', text: 'Sony FX3 kit' });
  const hidden = R.personRow({ displayName: 'Ana', roles: [], availability: 'open', miles: 12, rateMin: 250, ratesHidden: true, gear: [{ name: 'Van', flag: 'ask' }, { name: 'Kit', flag: 'brings' }] });
  assert.equal(hidden.mark, 'open');
  assert.equal(hidden.meta, '12 mi', 'a hidden rate is left out');
  assert.equal(hidden.gear.verb, 'Has', 'mixed flags');
  assert.equal(R.personRow({ displayName: 'X', roles: [], gear: [] }).gear, null);
  assert.equal(R.gearLine([{ name: 'Van', flag: 'ask' }]).verb, 'Ask about');
  assert.equal(R.rateText({ rateMin: null, rateMax: null }), 'Rate on request');
});

t('a performer’s row (Cast B): headshot, playing age and union, roles and distance', () => {
  const lena = R.castRow({ displayName: 'Lena Ruiz', roles: ['Actor', 'Singer', 'Dancer'], playingAgeMin: 25, playingAgeMax: 35, unionLabel: 'SAG-AFTRA', miles: 4, availability: 'open', headshots: [{ url: 'https://x.test/a.jpg' }] });
  assert.equal(lena.headshot, 'https://x.test/a.jpg');
  assert.equal(lena.playing, 'Plays 25–35 · SAG-AFTRA');
  assert.equal(lena.meta, 'Actor · Singer · 4 mi');
  assert.equal(lena.mark, 'open');
  const bare = R.castRow({ displayName: 'B', roles: ['Model'], headshots: [] });
  assert.equal(bare.headshot, null);
  assert.equal(bare.playing, 'Model', 'no age or union: the roles move up');
  assert.equal(R.playingAgeText(18, null), 'Plays 18+');
  assert.equal(R.playingAgeText(null, 12), 'Plays up to 12');
  assert.equal(R.playingAgeText(30, 30), 'Plays 30');
});

t('a call’s row: tags, the line, the pay', () => {
  const c = R.callRow({ title: 'Gaffer for a night exterior', role: 'Gaffer', spots: 1, startsOn: '2026-12-06', endsOn: '2026-12-06', place: 'Echo Park, Los Angeles', miles: 3, urgent: true, neededLabel: 'needed by Sat 7:00 AM', paySecured: true, payRateCents: 40000, payType: 'paid', payLabel: 'Paid', responsesCount: 4, poster: { displayName: 'Mara Reyes' }, matches: true });
  assert.deepEqual(c.tags.map((x) => x.text), ['⚡ Urgent · needed by Sat 7:00 AM', 'Matches your card']);
  assert.equal(c.meta, 'Gaffer · Sun, Dec 6 · Echo Park · 3 mi');
  assert.deepEqual(c.pay, { tone: 'paid', text: 'Pay secured · $400' });
  assert.equal(c.answered, '4 answered');
  assert.equal(c.poster, 'Mara Reyes');
  const cast = R.callRow({ title: 'Lead', role: 'Actor', spots: 2, startsOn: '2026-12-12', endsOn: '2026-12-14', remote: true, kind: 'cast', characterName: 'Lena', payType: 'deferred', payLabel: 'Deferred', payNote: '', responsesCount: 0, mine: true, productionTitle: 'Night Bus' });
  assert.deepEqual(cast.tags.map((x) => x.text), ['Casting · Lena', 'Yours', 'For Night Bus']);
  assert.equal(cast.meta, 'Actor · 2 spots · Dec 12–14 · Remote');
  assert.deepEqual(cast.pay, { tone: 'deferred', text: 'Deferred' });
  assert.equal(cast.answered, 'No answers yet');
  assert.equal(R.payText({ payType: 'paid', payLabel: 'Paid', payNote: '$250/day' }).text, 'Paid · $250/day');
  assert.equal(R.payText({ payType: 'unpaid', payLabel: 'Unpaid' }).tone, 'muted');
  assert.equal(R.callDates('2026-11-30', '2026-12-02'), 'Nov 30–Dec 2');
  assert.equal(R.callDates(null, null), 'Dates to confirm');
});

t('a piece of gear: what the owner does with it, and whose it is', () => {
  const g = R.gearRow({ name: 'Sony FX3 kit', category: 'Camera', flag: 'lends', flagLabel: 'Open to lending', owner: { displayName: 'Sam Ortiz', miles: 6 } });
  assert.deepEqual(g.flag, { tone: 'lends', text: 'Open to lending' });
  assert.equal(g.owner, 'Sam Ortiz · 6 mi');
  assert.equal(R.gearRow({ name: 'Van', flag: 'nonsense', owner: { displayName: 'Mara', place: 'Echo Park, LA' } }).owner, 'Mara · Echo Park');
});

t('empty lists and the free strip', () => {
  assert.equal(R.emptyLine('calls', { signedIn: true }).title, 'No open calls yet');
  assert.equal(R.emptyLine('calls', { filtered: true }).title, 'No calls match');
  assert.match(R.emptyLine('people', { signedIn: true, hasCard: false }).line, /Set up your card/);
  const now = Date.now();
  assert.equal(R.freeStrip(null, now).on, false);
  assert.equal(R.freeStrip(new Date(now - 1000).toISOString(), now).on, false);
  const on = R.freeStrip(new Date(now + 3600000).toISOString(), now);
  assert.equal(on.on, true);
  assert.match(on.title, /^⚡ Free until /);
  assert.equal(on.button, 'Turn off');
});

t('partial filters, the shared place, the badge and the small words', () => {
  assert.equal(R.apiPathFor('calls', { near: LA, within: 25 }), '/api/crew/calls?lat=34.05&lng=-118.24&within=25');
  assert.equal(R.urgentBadgePath(null, 0), '/api/crew/calls');
  assert.equal(R.filterCount('calls', { urgent: true }), 1);
  assert.equal(R.clearedFilters('gear', { gear: 'Camera' }).gear, '');
  const people = { ...R.emptyFilters(), gear: 'Camera', free: true };
  const moved = R.withPlace(people, LA, null);
  assert.equal(moved.near, LA);
  assert.equal(moved.within, 50);
  assert.equal(moved.gear, 'Camera', 'a tab keeps its own filters');
  assert.equal(R.withPlace(people, null, 25).within, 0);
  assert.equal(R.showButton('people', 7), 'Show 7 people');
  assert.equal(R.showButton('calls', 1), 'Show 1 open call');
  assert.equal(R.showButton('gear', null), 'Show results');
  assert.equal(R.urgentChip(2), '⚡ Urgent · 2');
  assert.equal(R.urgentChip(0), '⚡ Urgent');
  assert.equal(R.productionChip('Night Bus'), 'For Night Bus');
  assert.equal(R.productionChip(''), 'For one production');
  assert.equal(R.moreLabel(21), '+ 21 more');
  assert.equal(R.hoursLabel(4), '4 h');
  assert.equal(R.menuChip('Role'), 'Role ▾');
});

console.log(`\n${n} checks passed`);
