// node scripts/test-screening-rules.mjs — private screening links
// (lib/screeningRules.js, migration 128, 2026-11-21): Pacific wall time and
// the quick windows, the suggested password, checking a link's settings,
// its state and lines, who watched (people, places, the two-cities
// heads-up, watching now), what was turned away, the list and a link's own
// page, the invite and the viewer's words. The app's copy is checked word
// for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/screeningRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const iso = (s) => new Date(s).toISOString();
const NOW = Date.parse('2026-11-21T22:00:00Z'); // 2:00 PM PST, Saturday Nov 21

const link = (over = {}) => ({
  id: 'l1', token: 'tok', code: '7QX3F2', label: 'Sundance programmers', recipientEmail: null,
  target: { type: 'episode', id: 'salt-flats-a1' }, scope: 'title', season: null, episodeIds: null,
  startsAt: iso('2026-11-20T17:00:00Z'), endsAt: iso('2026-12-06T07:59:00Z'), endedAt: null,
  access: 'anyone', named: { userIds: [], emails: [] }, maxViews: 25, views: 7, perPerson: 3, oneScreen: true,
  countries: ['US'], notify: 'first', legacy: false, password: 'tide-lantern-42', ...over
});

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/screeningRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/screeningRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('Pacific wall time both ways, across the clock change', () => {
  assert.equal(R.fromPacificInput('2026-12-05T23:59'), '2026-12-06T07:59:00.000Z');
  assert.equal(R.fromPacificInput('2026-07-04T20:00'), '2026-07-05T03:00:00.000Z');
  assert.equal(R.toPacificInput('2026-12-06T07:59:00Z'), '2026-12-05T23:59');
  assert.equal(R.toPacificInput('2026-07-05T03:00:00Z'), '2026-07-04T20:00');
  assert.equal(R.fromPacificInput('2026-13-01T10:00'), null);
  assert.equal(R.fromPacificInput('nonsense'), null);
  assert.equal(R.pacificOffsetMinutes(Date.parse('2026-12-01T12:00:00Z')), -480);
  assert.equal(R.pacificOffsetMinutes(Date.parse('2026-07-01T12:00:00Z')), -420);
});

t('the Pacific rule agrees with the clock every hour for three years', () => {
  for (let at = Date.parse('2026-01-01T00:00:00Z'); at < Date.parse('2029-01-01T00:00:00Z'); at += 3600000) {
    assert.equal(R.pacificOffsetByRule(at), R.pacificOffsetMinutes(at), new Date(at).toISOString());
  }
});

t('the quick windows run from now to 11:59 PM Pacific on their last day', () => {
  const w = R.windowFor('2weeks', NOW);
  assert.equal(w.startsAt, new Date(NOW).toISOString());
  assert.equal(R.toPacificInput(w.endsAt), '2026-12-05T23:59');
  assert.equal(R.toPacificInput(R.windowFor('tonight', NOW).endsAt), '2026-11-21T23:59');
  const late = Date.parse('2026-11-22T07:30:00Z'); // 11:30 PM PST
  assert.equal(R.toPacificInput(R.windowFor('tonight', late).endsAt), '2026-11-22T23:59');
  assert.equal(R.toPacificInput(R.windowFor('nope', NOW).endsAt), '2026-12-05T23:59');
});

t('a suggested password is two words and a number', () => {
  let i = 0;
  const seq = [5, 5, 3, 41];
  const pw = R.suggestPassword(() => seq[i++ % seq.length]);
  assert.match(pw, /^[a-z]+-[a-z]+-\d{2}$/);
  const [a, b] = pw.split('-');
  assert.notEqual(a, b);
  for (let k = 0; k < 50; k += 1) assert.match(R.suggestPassword((m) => Math.floor(Math.random() * m)), /^[a-z]+-[a-z]+-[1-9]\d$/);
});

t('a new link is checked: who, the window, the password, the limits', () => {
  const ok = R.validateLink({ label: '  Sundance   programmers ', startsAt: iso('2026-11-01T00:00:00Z'), endsAt: iso('2026-12-06T07:59:00Z'), password: 'tide-lantern-42', countries: ['us', 'XX', 'US'], perPerson: 3 }, { now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.label, 'Sundance programmers');
  assert.equal(ok.value.startsAt, new Date(NOW).toISOString(), 'a start in the past is now');
  assert.deepEqual(ok.value.countries, ['US']);
  assert.equal(ok.value.scope, 'title');
  assert.equal(ok.value.maxViews, 25);
  assert.equal(ok.value.oneScreen, true);
  assert.equal(ok.value.notify, 'first');
  const bad = (input, field) => { const r = R.validateLink({ label: 'Press', endsAt: iso('2026-12-01T00:00:00Z'), password: 'longenough', ...input }, { now: NOW }); assert.equal(r.ok, false, JSON.stringify(input)); assert.equal(r.field, field); };
  bad({ label: 'x' }, 'label');
  bad({ password: 'short' }, 'password');
  bad({ password: 'has space in' }, 'password');
  bad({ endsAt: iso('2026-11-20T00:00:00Z') }, 'endsAt');
  bad({ endsAt: iso('2027-03-01T00:00:00Z') }, 'endsAt');
  bad({ endsAt: new Date(NOW + 5 * 60000).toISOString() }, 'endsAt');
  bad({ maxViews: 501 }, 'maxViews');
  bad({ perPerson: 21 }, 'perPerson');
  bad({ access: 'named' }, 'named');
  bad({ access: 'named', named: { emails: ['not-an-email'] } }, 'named');
  bad({ notify: 'loud' }, 'notify');
  bad({ countries: ['XX'] }, 'countries');
  bad({ recipientEmail: 'nope' }, 'recipientEmail');
  const noCap = R.validateLink({ label: 'Press', endsAt: iso('2026-12-01T00:00:00Z'), password: 'longenough', perPerson: null }, { now: NOW });
  assert.equal(noCap.value.perPerson, null);
});

t('a show link plays the whole show, a season of it, or picked episodes', () => {
  const target = { type: 'series', seasons: [1, 2], episodeIds: ['e1', 'e2', 'e3'] };
  const base = { label: 'Cinetic', endsAt: iso('2026-12-01T00:00:00Z'), password: 'longenough' };
  assert.equal(R.validateLink(base, { now: NOW, target }).value.scope, 'show');
  assert.equal(R.validateLink({ ...base, scope: 'season', season: 2 }, { now: NOW, target }).value.season, 2);
  assert.equal(R.validateLink({ ...base, scope: 'season', season: 3 }, { now: NOW, target }).field, 'season');
  assert.deepEqual(R.validateLink({ ...base, scope: 'episodes', episodeIds: ['e2', 'e2', 'zz', 'e1'] }, { now: NOW, target }).value.episodeIds, ['e2', 'e1']);
  assert.equal(R.validateLink({ ...base, scope: 'episodes', episodeIds: ['zz'] }, { now: NOW, target }).field, 'episodeIds');
});

t('an edit keeps what it doesn’t send; a started link keeps its start', () => {
  const l = link();
  const r = R.validateLink({ endsAt: iso('2026-12-10T07:59:00Z') }, { now: NOW, existing: l });
  assert.equal(r.ok, true);
  assert.equal(r.value.startsAt, undefined);
  assert.equal(r.value.endsAt, iso('2026-12-10T07:59:00Z'));
  assert.equal(r.value.password, undefined);
  assert.equal(r.value.label, 'Sundance programmers');
  assert.equal(R.validateLink({ maxViews: 5 }, { now: NOW, existing: l }).field, 'maxViews');
  assert.equal(R.validateLink({ endsAt: iso('2026-11-21T00:00:00Z') }, { now: NOW, existing: l }).field, 'endsAt');
  // A link that hasn't started can still move its start.
  const later = link({ startsAt: iso('2026-11-25T03:00:00Z'), endsAt: iso('2026-11-25T07:00:00Z'), views: 0 });
  assert.equal(R.validateLink({ startsAt: iso('2026-11-26T03:00:00Z'), endsAt: iso('2026-11-26T07:00:00Z') }, { now: NOW, existing: later }).value.startsAt, iso('2026-11-26T03:00:00Z'));
  // An older screener needs no password; it may get one.
  const old = link({ legacy: true, password: null });
  assert.equal(R.validateLink({ endsAt: iso('2026-12-01T00:00:00Z') }, { now: NOW, existing: old }).ok, true);
  assert.equal(R.validateLink({ password: 'fresh-pass-12' }, { now: NOW, existing: old }).value.password, 'fresh-pass-12');
});

t('a link’s state and its line', () => {
  assert.equal(R.linkState(link(), NOW).key, 'live');
  assert.equal(R.linkState(link({ views: 25 }), NOW).key, 'full');
  assert.equal(R.linkState(link({ startsAt: iso('2026-11-25T03:00:00Z') }), NOW).key, 'scheduled');
  const over = R.linkState(link({ endsAt: iso('2026-11-19T07:59:00Z') }), NOW);
  assert.equal(over.key, 'ended');
  assert.equal(over.label, 'Ended Nov 18');
  const stopped = R.linkState(link({ endedAt: iso('2026-11-10T20:00:00Z') }), NOW);
  assert.equal(stopped.label, 'Stopped by you Nov 10');
  assert.equal(R.linkState(link({ endedAt: iso('2026-11-10T20:00:00Z') }), NOW, { you: 'Mara Lin' }).label, 'Stopped by Mara Lin Nov 10');
  assert.equal(R.windowLine(link(), NOW), 'Ends Dec 5 · 11:59 PM PST');
  assert.equal(R.windowLine(link({ endsAt: iso('2026-11-24T07:59:00Z') }), NOW), 'Ends in 2 days · Nov 23');
  assert.equal(R.windowLine(link({ startsAt: iso('2026-11-25T03:00:00Z') }), NOW), 'Opens Nov 24 · 7:00 PM PST');
  assert.equal(R.opensIn(iso('2026-11-24T02:00:00Z'), NOW), '2 days, 4 hours');
  assert.equal(R.opensIn(new Date(NOW + 30 * 60000).toISOString(), NOW), '30 minutes');
  assert.deepEqual(R.linkActions(link({ endsAt: iso('2026-11-19T07:59:00Z') }), NOW), { copy: false, edit: false, editStart: false, newPassword: false, end: false, discard: true, runAgain: true });
  const again = R.againWindow(link(), NOW);
  assert.equal(Date.parse(again.endsAt) - Date.parse(again.startsAt), Date.parse(link().endsAt) - Date.parse(link().startsAt));
});

const views = [
  { id: 'v1', userId: 'user_dee', name: 'Dee Park', handle: 'deepark', city: 'Los Angeles', region: 'CA', country: 'US', device: 'iPhone · Safari', openedAt: iso('2026-11-21T22:14:00Z'), lastPlayAt: new Date(NOW - 30000).toISOString(), position: 4360, watched: { salt: [4360, 6060] } },
  { id: 'v2', userId: 'user_dee', name: 'Dee Park', handle: 'deepark', city: 'Los Angeles', region: 'CA', country: 'US', device: 'iPhone · Safari', openedAt: iso('2026-11-21T19:00:00Z'), watched: { salt: [1200, 6060] } },
  { id: 'v3', userId: null, deviceKey: 'dk1', city: 'Park City', region: 'UT', country: 'US', device: 'Mac · Chrome', openedAt: iso('2026-11-20T18:02:00Z'), watched: { salt: [6060, 6060] } },
  { id: 'v4', userId: 'user_rae', name: 'Rae Chen', city: 'Park City', region: 'UT', country: 'US', device: 'Mac · Safari', openedAt: iso('2026-11-20T21:50:00Z'), watched: { salt: [900, 6060] } },
  { id: 'v5', userId: 'user_rae', name: 'Rae Chen', city: 'Denver', region: 'CO', country: 'US', device: 'iPhone · Safari', openedAt: iso('2026-11-21T00:50:00Z'), watched: { salt: [1440, 6060] } },
  { id: 'v6', userId: 'user_rae', name: 'Rae Chen', city: 'Denver', region: 'CO', country: 'US', device: 'iPhone · Safari', openedAt: iso('2026-11-21T01:00:00Z'), watched: {} }
];
const refusals = [
  { id: 'r1', reason: 'password', city: 'Austin', region: 'TX', country: 'US', device: 'Windows · Edge', at: iso('2026-11-21T17:15:00Z') },
  { id: 'r2', reason: 'password', city: 'Austin', region: 'TX', country: 'US', device: 'Windows · Edge', at: iso('2026-11-21T17:14:00Z') },
  { id: 'r3', reason: 'password', city: 'Austin', region: 'TX', country: 'US', device: 'Windows · Edge', at: iso('2026-11-21T17:13:00Z') },
  { id: 'r4', reason: 'password', city: 'Austin', region: 'TX', country: 'US', device: 'Windows · Edge', at: iso('2026-11-21T17:12:00Z') },
  { id: 'r0', reason: 'password', city: 'Austin', region: 'TX', country: 'US', device: 'Windows · Edge', at: iso('2026-11-21T17:11:00Z') },
  { id: 'r5', reason: 'screen', userId: 'user_dee', name: 'Dee Park', city: 'Los Angeles', region: 'CA', country: 'US', device: 'Mac · Chrome', at: iso('2026-11-21T22:31:00Z') },
  { id: 'r6', reason: 'country', city: 'Toronto', region: 'ON', country: 'CA', device: 'Windows · Chrome', at: iso('2026-11-21T15:00:00Z') }
];

t('who watched: one row per person, watching now, the two-cities heads-up', () => {
  const people = R.peopleFrom(views, link(), NOW);
  assert.equal(people.length, 3);
  const [dee, rae, guest] = people;
  assert.equal(dee.name, 'Dee Park');
  assert.equal(dee.opens, 2);
  assert.equal(dee.opensLeft, 1);
  assert.equal(dee.watchingNow, true);
  assert.equal(R.positionLabel(dee.position), '1:12:40');
  assert.equal(dee.percent, 72);
  assert.equal(rae.twoCities, true);
  assert.equal(rae.twoCitiesLine, 'two cities 3 hours apart');
  assert.equal(rae.placeLine, 'Park City, UT → Denver, CO');
  assert.equal(rae.maxedOut, true);
  assert.equal(rae.watchedLine, '24 min · 24%');
  assert.equal(guest.guest, true);
  assert.equal(guest.name, 'Guest');
  assert.equal(guest.watchedLine, 'all of it');
});

t('the numbers, the places and the turned-away rows', () => {
  const nums = R.linkNumbers(link(), views, refusals, NOW);
  assert.equal(nums.people, 3);
  assert.equal(nums.signedIn, 2);
  assert.equal(nums.guests, 1);
  assert.equal(nums.cities, 3);
  assert.equal(nums.countryLine, 'all in the United States');
  assert.equal(nums.watchingNow, 1);
  assert.equal(nums.refused, 7);
  const places = R.placesFrom(views, refusals);
  assert.equal(places[0].place, 'Los Angeles, CA');
  assert.equal(places.find((p) => p.place === 'Austin, TX').line, '5 tries');
  assert.equal(places.find((p) => p.place === 'Toronto, ON, Canada').turnedAway, true);
  const rows = R.refusalRows(refusals, NOW);
  assert.equal(rows.length, 3);
  const pw = rows.find((r) => r.reason === 'password');
  assert.equal(pw.what, 'Wrong password, 5 times');
  assert.equal(pw.outcome, 'Locked out there for an hour');
  assert.equal(pw.when, 'Today, 9:15 AM');
  assert.equal(rows[0].who, 'Dee Park');
});

t('the list: filters with counts, live first, ended apart', () => {
  const links = [
    link({ id: 'a', stats: { people: 4, refused: 2, watchingNow: 1, watchedPercent: 68 } }),
    link({ id: 'b', label: 'Cast and crew night', startsAt: iso('2026-11-25T03:00:00Z'), endsAt: iso('2026-11-25T07:00:00Z'), views: 0, maxViews: 40, stats: {} }),
    link({ id: 'c', label: 'A24', endsAt: iso('2026-11-19T07:59:00Z'), views: 3, stats: { people: 2, watchedPercent: 74 } })
  ];
  const l = R.screeningsList(links, NOW);
  assert.deepEqual(l.filters.map((f) => f.text), ['All · 3', 'Live · 1', 'Opens later · 1', 'Ended · 1']);
  assert.deepEqual(l.open.map((c) => c.id), ['a', 'b']);
  assert.equal(l.ended[0].endedLine, '3 opens · 2 people · watched 74% on average');
  assert.equal(l.tabBadge, '1 live');
  assert.deepEqual(l.open[0].parts.map((p) => p.text), ['7 of 25 opens', '4 people', '2 stopped']);
  assert.equal(R.screeningsList(links, NOW, 'later').open.length, 1);
  assert.equal(R.screeningsList([], NOW).empty, true);
});

t('a link’s own page', () => {
  const d = R.linkDashboard({ link: link(), target: { type: 'episode', id: 'salt', title: 'Salt Flats' }, views, refusals, now: NOW });
  assert.equal(d.sub, 'Plays Salt Flats · anyone with the password · code 7QX3F2');
  assert.deepEqual(d.tiles.map((x) => x.value), ['7', '3', '65%', '3 cities']);
  assert.equal(d.timeline.leftLabel, 'Ends in 14 days');
  assert.equal(d.settings.find((s) => s.key === 'where').value, 'Only in the United States');
  assert.equal(d.settings.find((s) => s.key === 'limits').value, '25 opens, 3 each, one screen at a time');
  const show = R.linkDashboard({ link: link({ scope: 'season', season: 1 }), target: { type: 'series', id: 'nb', title: 'Night Bus' }, views: [], refusals: [], now: NOW });
  assert.match(show.sub, /^Plays Night Bus · Season 1/);
  assert.equal(show.tiles[1].sub, 'nobody yet');
});

t('places, devices, countries', () => {
  assert.equal(R.placeLabel({ city: 'Los Angeles', region: 'CA', country: 'US' }), 'Los Angeles, CA');
  assert.equal(R.placeLabel({ country: 'CA' }), 'Canada');
  assert.equal(R.placeLabel({}), 'Place unknown');
  assert.equal(R.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.equal(R.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'), 'Windows · Edge');
  assert.equal(R.deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'), 'Android phone · Chrome');
  assert.equal(R.deviceLabel(''), 'A device we couldn’t tell');
  assert.equal(R.countriesLine([]), 'Anywhere');
  assert.equal(R.countriesLine(['US']), 'Only in the United States');
  assert.equal(R.countriesLine(['CA', 'MX']), 'Only in Canada and Mexico');
  assert.equal(R.countryName('jp'), 'Japan');
  assert.equal(new Set(R.COUNTRIES.map((c) => c[0])).size, R.COUNTRIES.length);
});

t('the invite, the viewer’s lines and the watermark', () => {
  const text = R.inviteText({ title: 'Salt Flats', ownerName: 'Mara Lin', url: 'https://www.studiotapatv.site/screener/tok', startsAt: link().startsAt, endsAt: link().endsAt, password: 'tide-lantern-42', now: NOW });
  assert.match(text, /^Here’s a private screening of Salt Flats from Mara Lin\./);
  assert.ok(!text.includes('tide-lantern-42'));
  assert.match(text, /until Dec 5 · 11:59 PM PST\. Please don’t forward it/);
  assert.ok(R.inviteText({ title: 'X', url: 'u', startsAt: link().startsAt, endsAt: link().endsAt, password: 'pw-pw-pw-12', includePassword: true, now: NOW }).includes('Password: pw-pw-pw-12'));
  assert.deepEqual(R.viewerLine('locked', { retryAt: '10:15 AM' }), { title: 'Too many tries', line: 'The password was wrong too many times from here. Try again at 10:15 AM.' });
  assert.equal(R.viewerLine('country', { owner: 'Mara Lin', countries: R.countriesLine(['US']).replace(/^Only/, 'only') }).line, 'Mara Lin set this screening to work only in the United States.');
  assert.equal(R.viewerLine('who-knows').title, 'Not available');
  assert.match(R.passwordNote({ owner: 'Mara', access: 'anyone' }), /Sign in and Mara sees your name instead of “Guest”\.$/);
  assert.match(R.passwordNote({ owner: 'Mara', signedIn: true, viewerName: 'Dee Park' }), /signed in as Dee Park, so Mara sees your name\.$/);
  assert.equal(R.watermarkText({ viewerName: 'Dee Park', label: 'Sundance programmers', code: '7QX3F2' }), 'Dee Park · Sundance programmers · 7QX3F2');
  assert.equal(R.targetTabHref({ type: 'series', id: 'night-bus' }), '/creator/show/night-bus?tab=screenings');
  assert.equal(R.screeningHref('abc'), '/creator/screenings/abc');
  assert.match(R.notifyLines({ kind: 'opened', label: 'Press', title: 'Salt Flats', who: 'Dee Park', place: 'Los Angeles, CA' }), /^“Press” for Salt Flats was opened by Dee Park in Los Angeles, CA\.$/);
});

console.log(`\n${n} checks passed`);
