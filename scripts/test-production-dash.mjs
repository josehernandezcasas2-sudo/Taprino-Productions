// node scripts/test-production-dash.mjs — productions from pitches and the
// production dashboard (lib/productionDashRules.js, 2026-11-19; part B of
// mockups/productions-yearly-contract.md): who runs a production, the
// dashboard built from its facts (numbers, Needs you, sections), Your
// productions, the pitch page's card and Start / Open, Your pitches' box,
// the start sheet and the update it posts. The app's copy is checked word
// for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/productionDashRules.js';
import { PRODUCTION_KINDS } from '../lib/productionRules.js';
import { PITCH_TAGS } from '../lib/pitchRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const PID = '11111111-2222-4333-8444-555555555555';
const PITCH = '99999999-2222-4333-8444-555555555555';

t('the app copy is the website file word for word, with no imports', () => {
  const web = readFileSync(new URL('../lib/productionDashRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/productionDashRules.js', import.meta.url), 'utf8');
  assert.equal(app, web);
  assert.equal(web.split('\n').filter((l) => /^import\s/.test(l)).length, 0);
});

t('who runs it: the owner, a listed producer, a full admin', () => {
  const members = [
    { userId: 'u_pro', role: 'Producer' },
    { user_id: 'u_exec', role: 'Executive producer' },
    { userId: 'u_line', role: 'Line producer' },
    { userId: 'u_co', role: 'Co-Producer' },
    { userId: 'u_gone', role: 'Producer', hidden: true },
    { userId: 'u_dp', role: 'DP' }
  ];
  const p = { ownerId: 'u_owner', members };
  for (const id of ['u_owner', 'u_pro', 'u_exec', 'u_line', 'u_co']) assert.equal(R.canManageProduction(p, id), true, id);
  for (const id of ['u_gone', 'u_dp', 'u_stranger', null]) assert.equal(R.canManageProduction(p, id), false, String(id));
  assert.equal(R.canManageProduction(p, 'u_stranger', { isAdmin: true }), true);
  assert.equal(R.canOwnProduction(p, 'u_owner'), true);
  assert.equal(R.canOwnProduction(p, 'u_pro'), false);
  assert.equal(R.canOwnProduction(p, null, { isAdmin: true }), true);
  assert.deepEqual(R.managerIds(p), ['u_owner', 'u_pro', 'u_exec', 'u_line', 'u_co']);
  assert.equal(R.isProducerRole('Gaffer'), false);
  assert.equal(R.isProducerRole(null), false);
});

t('statuses: a producer moves prep–released, the owner archives too, archived is locked for a producer', () => {
  assert.deepEqual(R.statusOptions({ canOwn: false, current: 'prep' }).map((o) => o.value), ['prep', 'shooting', 'post', 'released']);
  assert.deepEqual(R.statusOptions({ canOwn: true, current: 'prep' }).map((o) => o.value), ['prep', 'shooting', 'post', 'released', 'archived']);
  const archived = R.statusOptions({ canOwn: false, current: 'archived' });
  assert.equal(archived.find((o) => o.value === 'archived').disabled, true);
  assert.equal(R.statusLocked({ canOwn: false, current: 'archived' }), true);
  assert.equal(R.statusLocked({ canOwn: true, current: 'archived' }), false);
  assert.equal(R.statusShort('constructor'), '');
});

t('kinds: the same keys as the server, a pitch tag maps where it fits', () => {
  assert.deepEqual(Object.keys(R.KIND_SHORT).sort(), Object.keys(PRODUCTION_KINDS).sort());
  for (const tag of PITCH_TAGS) {
    const k = R.kindFromTag(tag);
    assert.ok(k === null || Object.prototype.hasOwnProperty.call(PRODUCTION_KINDS, k), tag);
  }
  assert.equal(R.kindFromTag('Short Film'), 'short');
  assert.equal(R.kindFromTag('Narrative Film'), 'feature');
  assert.equal(R.kindFromTag('Animation'), null);
  assert.equal(R.kindFromTag('toString'), null);
});

t('money and dates', () => {
  assert.equal(R.money(324000), '$3,240');
  assert.equal(R.money(307840), '$3,078.40');
  assert.equal(R.money(5), '$0.05');
  assert.equal(R.money(0), '$0');
  assert.equal(R.money(123456789), '$1,234,567.89');
  assert.equal(R.rangeLabel('2026-12-06', '2026-12-09'), 'Dec 6 – 9');
  assert.equal(R.rangeLabel('2026-12-30', '2027-01-02'), 'Dec 30 – Jan 2');
  assert.equal(R.rangeLabel('2026-12-06', '2026-12-06'), 'Dec 6');
  assert.equal(R.rangeLabel(null, '2026-12-06'), '');
  assert.equal(R.weekdayLabel('2026-12-05'), 'Sat Dec 5');
  assert.equal(R.daysBetween('2026-11-19', '2026-12-06'), 17);
  assert.equal(R.addDays('2026-12-30', 7), '2027-01-06');
  assert.equal(R.timeLabel('06:30'), '6:30');
  assert.equal(R.timeLabel('18:00'), '18:00');
  assert.equal(R.timeLabel('25:00'), '');
  assert.equal(R.placeShort('Echo Park, Los Angeles'), 'Echo Park');
});

function facts(over = {}) {
  return {
    today: '2026-11-19',
    now: '2026-11-19T18:00:00.000Z',
    production: { id: PID, title: 'Night Bus', logline: 'A driver…', kind: 'short', status: 'prep', startsOn: '2026-12-06', endsOn: '2026-12-09', placeLabel: 'Echo Park, Los Angeles', visibility: 'public', pitch: { id: PITCH, title: 'Night Bus' }, release: null },
    viewer: { userId: 'u_owner', isOwner: true, isProducer: false, isAdmin: false, canManage: true, canOwn: true, canConfirm: false },
    owner: { userId: 'u_owner', name: 'Mara Ortiz' },
    members: [
      { id: 'm1', userId: 'u_dee', name: 'Dee Park', role: 'DP', department: 'Camera', worked: false, viaCall: false, isOwner: false, isViewer: false, pay: null, callId: null, producer: false },
      { id: 'm2', userId: 'u_sam', name: 'Sam Lee', role: '1st AC', department: 'Camera', worked: false, viaCall: true, isOwner: false, isViewer: false, pay: 'held', callId: 'c2', producer: false },
      { id: 'm3', userId: 'u_ana', name: 'Ana Ruiz', role: 'Gaffer', department: 'Lighting & grip', worked: false, viaCall: true, isOwner: false, isViewer: false, pay: 'unfunded', callId: 'c1', producer: false },
      { id: 'm4', userId: 'u_lou', name: 'Lou Chen', role: 'Producer', department: 'Direction', worked: false, viaCall: false, isOwner: false, isViewer: false, pay: null, callId: null, producer: true }
    ],
    calls: [
      { id: 'c1', title: 'Key grip for a night shoot', role: 'Key grip', spots: 2, status: 'open', payType: 'paid', payLabel: 'Paid', payNote: '$300/day', paySecured: false, payRateCents: null, startsOn: '2026-12-06', endsOn: '2026-12-09', closesOn: '2026-12-16', waiting: 3, answers: 4, booked: 1, forPitch: false },
      { id: 'c2', title: 'Boom op', role: 'Boom op', spots: 1, status: 'open', payType: 'paid', payLabel: 'Paid', payNote: '', paySecured: true, payRateCents: 105000, startsOn: '2026-12-06', endsOn: '2026-12-09', closesOn: '2026-12-16', waiting: 0, answers: 1, booked: 1, forPitch: false },
      { id: 'c3', title: 'Old call', role: 'PA', spots: 1, status: 'closed', payType: 'unpaid', payLabel: 'Unpaid', payNote: '', paySecured: false, payRateCents: null, startsOn: null, endsOn: null, closesOn: null, waiting: 2, answers: 2, booked: 0, forPitch: true }
    ],
    days: [
      { id: 'd1', dayNo: 1, shootOn: '2026-12-06', callTime: '06:30', wrapTime: '', placeLabel: 'Echo Park depot', paid: true },
      { id: 'd2', dayNo: 2, shootOn: '2026-12-07', callTime: '18:00', wrapTime: '', placeLabel: '', paid: false },
      { id: 'd3', dayNo: 3, shootOn: '2026-12-09', callTime: '18:00', wrapTime: '', placeLabel: '', paid: false },
      { id: 'd0', dayNo: 0, shootOn: '2026-11-01', callTime: '', wrapTime: '', placeLabel: '', paid: false }
    ],
    places: [
      { id: 'r1', title: 'Echo Park depot', status: 'paid', startsOn: '2026-12-06', endsOn: '2026-12-06', totalCents: 48000, respondsBy: null, mine: true },
      { id: 'r2', title: 'Union Station platform', status: 'requested', startsOn: '2026-12-07', endsOn: '2026-12-09', totalCents: 90000, respondsBy: '2026-11-21T01:00:00.000Z', mine: true },
      { id: 'r3', title: 'Rooftop', status: 'countered', startsOn: '2026-12-08', endsOn: '2026-12-08', totalCents: 20000, respondsBy: '2026-11-21T01:00:00.000Z', mine: true }
    ],
    pay: { heldCents: 105000, heldPeople: 1, releasedCents: 0, releasedPeople: 0, pendingCents: 0 },
    pitch: { id: PITCH, title: 'Night Bus', goalCents: 500000, raisedCents: 324000, toCreatorCents: 307800, cutPercent: 5, backers: 41, deadline: '2026-12-01', fundingEnabled: true, lastUpdateAt: '2026-11-02T10:00:00Z', firstBackedAt: '2026-10-01T10:00:00Z', latestBackers: ['Jo', 'Priya'], isOwner: true },
    release: { released: false, title: null, href: null, checklist: { released: false, buyToOwn: false, earlyScreening: false, festivalsSubmitted: 1, trailer: true, pressKit: false, shotHere: 0, screenersLive: 0 }, screenersLive: 0, canOpen: true },
    ...over
  };
}

t('Needs you: answers waiting, days with no place, unfunded pay, quiet backers, a counter to answer', () => {
  const needs = R.needsYou(facts());
  const ids = needs.map((x) => x.id);
  assert.deepEqual(ids, ['answers-c1', 'days-no-place', 'fund-m3', 'backers-quiet', 'place-r3']);
  assert.equal(needs[0].text + needs[0].strong, '3 answers waiting on Key grip');
  assert.equal(needs[0].link.href, '/crew/calls/c1');
  assert.equal(needs[1].text, 'Days 2 and 3 have no place');
  assert.equal(needs[2].text, 'Ana Ruiz’s secured pay isn’t funded');
  assert.equal(needs[3].text, 'Your backers haven’t heard from you in 17 days');
  assert.equal(needs[3].link.href, `/productions/${PID}/dashboard?tab=money#update`);
  assert.equal(needs[4].link.href, '/locations/requests/r3');
  // A producer who doesn't own the pitch isn't told to post updates.
  const producer = R.needsYou(facts({ pitch: { ...facts().pitch, isOwner: false } }));
  assert.ok(!producer.some((x) => x.id === 'backers-quiet'));
  // 13 days is not quiet yet.
  const recent = R.needsYou(facts({ pitch: { ...facts().pitch, lastUpdateAt: '2026-11-06T10:00:00Z' } }));
  assert.ok(!recent.some((x) => x.id === 'backers-quiet'));
});

t('Needs you: after the last day, who worked it; an accepted place to pay', () => {
  const after = facts({ today: '2026-12-12', viewer: { ...facts().viewer, canConfirm: true }, places: [{ id: 'r9', title: 'Rooftop', status: 'accepted', startsOn: '2026-12-20', endsOn: '2026-12-20', totalCents: 1, mine: true }, { id: 'r8', title: 'Not mine', status: 'accepted', mine: false }] });
  const needs = R.needsYou(after);
  const confirm = needs.find((x) => x.id === 'confirm-worked');
  assert.equal(confirm.text, 'Confirm who worked it · 4 people');
  assert.equal(confirm.link.href, `/productions/${PID}/dashboard?tab=crew`);
  assert.ok(needs.some((x) => x.id === 'place-r9' && x.text === 'Rooftop said yes — pay to confirm'));
  assert.ok(!needs.some((x) => x.id === 'place-r8'));
  // Past days don't need a place any more.
  assert.ok(!needs.some((x) => x.id === 'days-no-place'));
  assert.equal(R.needsLabel(1, 'Confirm who worked it'), 'Confirm who worked it');
  assert.equal(R.needsLabel(4, 'x'), '4 need you');
  assert.equal(R.needsLabel(0), null);
});

t('the four numbers', () => {
  const tiles = R.dashTiles(facts());
  assert.deepEqual(tiles.map((x) => [x.label, x.value, x.sub]), [
    ['Raised', '$3,240', 'of $5,000 · 41 backers'],
    ['Crew', '4 booked', '1 role still open'],
    ['Next shoot day', 'Sun Dec 6', 'call 6:30 · in 17 days'],
    ['Crew pay held', '$1,050', 'for 1 person']
  ]);
  const bare = R.dashTiles(facts({ pitch: null, days: [], production: { ...facts().production, startsOn: null, endsOn: null }, pay: {} }));
  assert.deepEqual(bare.map((x) => x.value), ['—', '4 booked', 'Not set', '$0']);
  assert.equal(bare[0].sub, 'Not tied to a pitch');
});

t('the whole dashboard: head, sections, release', () => {
  const v = R.productionDashboard(facts());
  assert.equal(v.head.kicker, 'Production dashboard · Short');
  assert.deepEqual(v.head.meta, ['Dec 6 – 9', 'Echo Park, Los Angeles', 'Public']);
  assert.equal(v.head.grewOut.href, `/pitches/${PITCH}`);
  assert.equal(v.head.back.href, '/productions/mine');
  assert.deepEqual(v.actions.map((a) => a.label), ['Post a call', 'Add a day', 'Book a place', 'Message crew', 'Edit']);
  assert.equal(v.actions[0].href, `/crew/calls/new?production=${PID}`);
  assert.deepEqual(v.tabs.map((x) => x.label), ['Overview', 'Crew', 'Calls', 'Days & call sheets', 'Money', 'Release & distribution']);
  assert.equal(v.needs.title, 'Needs you · 5');
  assert.equal(v.funding.state, 'Backing open · 12 days left');
  assert.equal(v.funding.line, '$3,240 of $5,000 · 12 days left · $3,078 to you after the 5% cut');
  assert.equal(v.funding.latest, 'Latest backers: Jo, Priya and 39 more');
  assert.equal(v.calls.title, 'Calls · 2 open');
  assert.equal(v.calls.rows[0].answers.text, '3 waiting');
  assert.equal(v.calls.rows[1].line, 'Dec 6 – 9 · Paid $1,050 · secured');
  assert.equal(v.calls.rows[2].closes, 'closed');
  assert.deepEqual(v.crew.groups.map((g) => g.name), ['Camera', 'Lighting & grip', 'Direction']);
  assert.equal(v.crew.groups[1].people[0].state.text, 'pay not funded');
  assert.equal(v.crew.groups[0].people[1].state.text, 'pay held');
  // The owner removes a producer; a producer doesn't.
  assert.equal(v.crew.groups[2].people[0].actions.remove, true);
  const asProducer = R.productionDashboard(facts({ viewer: { ...facts().viewer, isOwner: false, isProducer: true, canOwn: false } }));
  assert.equal(asProducer.crew.groups[2].people[0].actions.remove, false);
  assert.equal(asProducer.crew.groups[0].people[0].actions.remove, true);
  assert.equal(asProducer.funding.line, '$3,240 of $5,000 · 12 days left · $3,078 to Mara after the 5% cut');
  assert.equal(asProducer.release.button, null);
  assert.equal(asProducer.release.note, 'The owner runs distribution and screeners.');
  const day = (label) => v.days.rows.find((d) => d.label === label);
  assert.equal(day('Day 2').place.text, 'No place yet');
  assert.equal(day('Day 2').place.tone, 'warn');
  assert.equal(day('Day 3').when, 'Wed Dec 9 · 18:00');
  assert.equal(day('Day 0').past, true);
  assert.equal(v.days.rows.find((d) => d.label === 'Day 1').place.text, 'Echo Park depot · paid');
  assert.deepEqual(v.places.rows.map((r) => r.state.text), ['host countered — your answer', 'asked, host has 31 h to answer', 'paid $480']);
  assert.equal(v.release.line, 'Not released yet · checklist 2 of 8 · no screeners');
  assert.equal(v.release.button.href, `/productions/${PID}/distribution`);
  assert.equal(v.crewView.href, `/productions/${PID}`);
  const none = R.productionDashboard(facts({ pitch: null }));
  assert.equal(none.funding.none, true);
  assert.equal(none.funding.title, 'Not tied to a pitch');
  assert.equal(R.productionDashboard(null), null);
});

t('tabs and the dashboard address', () => {
  assert.equal(R.dashTab('crew'), 'crew');
  assert.equal(R.dashTab('nope'), 'overview');
  assert.equal(R.dashHref(PID), `/productions/${PID}/dashboard`);
  assert.equal(R.dashHref(PID, 'days'), `/productions/${PID}/dashboard?tab=days`);
  assert.equal(R.isProductionId(PID), true);
  assert.equal(R.isProductionId('../x'), false);
  const g = R.groupsUpTo([{ name: 'A', people: [1, 2, 3] }, { name: 'B', people: [4, 5] }], 4);
  assert.deepEqual(g.map((x) => x.people.length), [3, 1]);
});

t('Your productions: running, on the crew, done; a card each', () => {
  const items = [
    { id: 'a', title: 'Night Bus', kind: 'short', status: 'prep', startsOn: '2026-12-06', endsOn: '2026-12-09', placeLabel: 'Echo Park, Los Angeles', fromPitch: true, crewCount: 4, openRoles: 2, raisedCents: 324000, needsYou: 4, needsShort: 'x', manage: true },
    { id: 'b', title: 'Paper Moons', kind: 'feature', status: 'post', startsOn: '2026-10-02', endsOn: '2026-10-20', placeLabel: 'Downtown', fromPitch: false, crewCount: 9, openRoles: 0, raisedCents: 0, needsYou: 1, needsShort: 'Confirm who worked it', manage: true },
    { id: 'c', title: 'Someone else’s', kind: 'documentary', status: 'shooting', manage: false, myRoles: ['Gaffer'] },
    { id: 'd', title: 'Done one', kind: 'short', status: 'released', manage: true },
    { id: 'e', title: 'Archived', kind: 'short', status: 'archived', manage: true }
  ];
  const g = R.mineGroups(items);
  assert.deepEqual(g.tabs.map((x) => x.label), ['Running · 2', 'On the crew · 1', 'Done · 2']);
  const a = R.yoursCard(items[0], '2026-11-19');
  assert.equal(a.line, 'Short · Dec 6 – 9 · Echo Park · from the pitch');
  assert.deepEqual(a.stats, ['4 crew · 2 open', '$3,240 raised']);
  assert.equal(a.needs, '4 need you');
  assert.deepEqual(a.button, { href: '/productions/a/dashboard', label: 'Open the dashboard', primary: true });
  const b = R.yoursCard(items[1], '2026-11-19');
  assert.equal(b.line, 'Feature · shot Oct 2 – 20 · Downtown');
  assert.equal(b.needs, 'Confirm who worked it');
  const c = R.yoursCard(items[2], '2026-11-19');
  assert.deepEqual(c.stats, ['You: Gaffer']);
  assert.equal(c.button.href, '/productions/c');
  assert.equal(R.mineTab('crew'), 'crew');
  assert.equal(R.mineTab('x'), 'running');
  assert.equal(R.readyPitchCard({ id: 'p', title: 'Night Owl Radio', raisedCents: 118000 }).line, 'Night Owl Radio has $1,180 backed. Start its production and gather crew while it keeps raising.');
  assert.equal(R.readyPitchCard({ id: 'p', title: 'Quiet', raisedCents: 0 }).line, 'Quiet is approved. Start its production and gather crew while it keeps raising.');
});

t('the menu line: prep with the next day, shooting until, post', () => {
  assert.equal(R.runningLine({ status: 'prep', nextShootOn: '2026-12-06' }, '2026-11-19'), 'Prep · shooting Dec 6');
  assert.equal(R.runningLine({ status: 'prep', startsOn: '2026-11-01' }, '2026-11-19'), 'Prep');
  assert.equal(R.runningLine({ status: 'shooting', endsOn: '2026-11-22' }, '2026-11-19'), 'Shooting · until Nov 22');
  assert.equal(R.runningLine({ status: 'post' }, '2026-11-19'), 'Post');
});

t('the pitch page: the card, Start or Open, Crew needed', () => {
  const card = R.pitchProductionCard({ id: PID, title: 'Night Bus', status: 'prep', startsOn: '2026-12-06', endsOn: '2026-12-09', placeLabel: 'Echo Park, Los Angeles', crewCount: 4, openRoles: 2 }, '2026-11-19');
  assert.deepEqual(card, { pill: 'In production', title: 'Shooting Dec 6 – 9 in Echo Park', line: 'Prep · 4 crew on it · 2 roles open', link: { href: `/productions/${PID}`, label: 'The production' } });
  assert.equal(R.pitchProductionCard({ id: PID, status: 'post', crewCount: 1 }, '2026-11-19').title, 'In post');
  assert.equal(R.pitchProductionCard({ id: PID, status: 'shooting', startsOn: '2026-11-01', endsOn: '2026-11-03', crewCount: 0 }, '2026-11-19').title, 'Shot Nov 1 – 3');
  assert.equal(R.pitchProductionCard(null), null);
  assert.deepEqual(R.pitchOwnerAction({ isPitchOwner: true }), { kind: 'start', label: 'Start the production' });
  assert.equal(R.pitchOwnerAction({ isPitchOwner: false }), null);
  assert.deepEqual(R.pitchOwnerAction({ isPitchOwner: true, production: { id: PID }, canManage: true }), { kind: 'dashboard', label: 'Open its dashboard', href: `/productions/${PID}/dashboard` });
  assert.equal(R.pitchOwnerAction({ isPitchOwner: true, production: { id: PID }, canManage: false }), null);
  assert.deepEqual(R.crewNeededHead(2, { id: PID }), { title: 'Crew needed · 2', all: { href: `/crew?production=${PID}`, label: 'All calls' }, note: 'From the production’s calls, and any posted for the pitch.' });
  assert.deepEqual(R.crewNeededHead(0, null), { title: 'Crew needed', all: null, note: null });
});

t('the production page’s Funding card', () => {
  assert.equal(R.productionFundingCard(null), null);
  assert.deepEqual(R.productionFundingCard({ pitchId: PITCH, title: 'Night Bus', raisedCents: 324000, goalCents: 500000, backers: 41, open: true, href: `/pitches/${PITCH}` }), { kicker: 'Funding · Night Bus', line: '$3,240 of $5,000 · 41 backers', percent: 65, button: { href: `/pitches/${PITCH}#fund`, label: 'Back it', primary: true } });
  const closed = R.productionFundingCard({ pitchId: PITCH, title: 'Quiet', raisedCents: 0, goalCents: null, backers: 0, open: false, href: `/pitches/${PITCH}` });
  assert.equal(closed.line, '$0 raised');
  assert.equal(closed.percent, null);
  assert.deepEqual(closed.button, { href: `/pitches/${PITCH}`, label: 'On the pitch page', primary: false });
});

t('Your pitches: Ready to shoot it? or In production', () => {
  assert.equal(R.pitchBox({ pitch: { status: 'pending' } }), null);
  const start = R.pitchBox({ pitch: { status: 'approved' } });
  assert.equal(start.kind, 'start');
  assert.equal(start.title, 'Ready to shoot it?');
  const running = R.pitchBox({ pitch: { status: 'approved' }, production: { id: PID, status: 'prep', startsOn: '2027-01-10', endsOn: '2027-01-20', crewCount: 5, openRoles: 3 }, today: '2026-11-19' });
  assert.equal(running.line, 'Shooting from Jan 10 · 5 crew booked · 3 roles open');
  assert.equal(running.button.href, `/productions/${PID}/dashboard`);
});

t('the start sheet: filled in from the pitch; the update it posts; the line after', () => {
  const s = R.startSheet({ id: PITCH, title: 'Night Bus', logline: 'A driver  on the\nlast route.', tag: 'Short Film' }, 41);
  assert.equal(s.kicker, 'From the pitch · Night Bus');
  assert.deepEqual(s.defaults, { title: 'Night Bus', logline: 'A driver on the last route.', kind: 'short', startsOn: '', endsOn: '', place: null, tellBackers: true });
  assert.equal(s.tell.title, 'Tell my 41 backers');
  assert.equal(s.tell.line, 'Posts “Night Bus is now in production” as an update.');
  assert.equal(R.startSheet({ title: 'X', tag: 'Animation' }, 0).defaults.kind, null);
  assert.equal(R.startSheet({ title: 'X' }, 0).tell.title, 'Tell the people following it');
  assert.equal(s.kinds.length, Object.keys(PRODUCTION_KINDS).length);
  const u = R.productionUpdate({ title: 'Night Bus', startsOn: '2026-12-06', endsOn: '2026-12-09', placeLabel: 'Echo Park, Los Angeles' });
  assert.equal(u.title, 'Night Bus is now in production');
  assert.equal(u.body, 'We’re starting the production. Shooting Dec 6 – 9 in Echo Park. Backing stays open while we shoot, and crew calls for it are on Crew Call.');
  assert.ok(R.productionUpdate({ title: 'x'.repeat(200) }).title.length <= 140);
  assert.match(R.startedFlash('yes'), /backers and the people following the pitch were told/);
  assert.match(R.startedFlash('later'), /three updates today/);
  assert.equal(R.startedFlash('nope'), 'The production is started. Post a call, add shoot days and book places from here.');
});

console.log(`\n${n} checks passed`);
