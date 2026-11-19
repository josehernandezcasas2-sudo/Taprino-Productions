// Productions from pitches, and the production dashboard (2026-11-19; part
// B of mockups/productions-yearly-contract.md): POST
// /api/pitches/<id>/production, the pitch page's card and merged Crew
// needed, who runs a production (the owner, a listed producer, full
// admins), GET /api/productions/<id>/dashboard and its page, Your
// productions (/productions/mine), GET /api/productions/running and the ☰
// menu's "Running now", Your pitches' box and the start sheet, the
// production page's Dashboard link and Funding card.
//
// Seeds a run of its own: an owner (a creator), a producer, a crew member,
// a backer and a stranger; three of the owner's pitches (approved,
// pending, approved with nothing started) and one of the stranger's; a
// paid backing; then, once the production is started, a crew list, calls
// with answers, secured pay (one held, one not funded), a call posted for
// the pitch, shoot days and two place requests. Checks:
//   - start: signed out 401, someone else's pitch 403, a pending one 409,
//     the owner's 201 (public, linked, an update posted, the backer told),
//     a second time 409 with the production's id, the production form
//     linking the same pitch 409;
//   - who runs it: the producer changes the status, the details, the crew
//     and the days and posts a call for it; not visibility, archiving, the
//     release, a producer's row or the owner's row; a stranger is refused;
//   - the dashboard's facts and what the rules make of them (the numbers,
//     Needs you), for the owner, the producer, an admin; a stranger and
//     signed out are refused and sent to the production page;
//   - the pitch page signed out and as the owner, /api/pitch-detail;
//   - Your productions and the running route for the owner, the producer,
//     the crew member and the stranger;
//   - the browser: the dashboard at 390 and 1280 (tabs, a tab's address,
//     Needs you's links, the crew tab's Worked it / Remove), Your
//     productions, the menu's card at 390 and 1280 (Open goes to the
//     dashboard), Your pitches' box and the start sheet (a sheet at 390, a
//     dialog at 1280, focus, Escape, submit → the new dashboard with its
//     line), the production page's link and card; no sideways scroll at
//     320 / 390 / 1280, no page errors.
// Removes everything it made.
//
//   node dev/test-rig/checks/productions-dashboard.mjs   (the rig must be up)
//   SHOTS=<dir> keeps screenshots.
import crypto from 'node:crypto';
import { RUN, USERS, SIGNED_OUT, ok, section, runCheck, browser, goto, overflowPx, rows, sql, q, call, page, session, newUser, removeUser, insert, ago } from './lib.mjs';
import { productionDashboard, needsYou } from '../../../lib/productionDashRules.js';

const pacific = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));
const uuid = () => crypto.randomUUID();
const PITCH = uuid();
const PENDING = uuid();
const PITCH2 = uuid();
const STRANGER_PITCH = uuid();
const LOC = uuid();
const REQ = { asked: uuid(), countered: uuid() };
const CALL = { grip: uuid(), boom: uuid(), sound: uuid(), pa: uuid() };
const RESP = { g1: uuid(), g2: uuid(), boom: uuid(), sound: uuid() };
const TITLE = `Night Bus ${RUN}`;
const shot = async (pg, name) => { if (process.env.SHOTS) await pg.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }).catch(() => {}); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, who, body, method = 'POST') => call(path, { who, method, body, headers: { Origin: 'http://localhost:3100' } });
// A tab, once the page has hydrated: a click that lands before React has
// attached its handlers (next dev compiling a fresh page) is tried again.
async function clickTab(pg, id) {
  for (let i = 0; i < 3; i += 1) {
    await pg.click(`#pd-tab-${id}`);
    const on = await pg.waitForSelector(`#pd-tab-${id}[aria-selected="true"]`, { timeout: 3000 }).then(() => true).catch(() => false);
    if (on) break;
  }
  // The address follows (a shallow replace, which next dev can be slow with).
  await pg.waitForURL(new RegExp(`[?&]tab=${id}`), { timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(300);
}

await runCheck('productions-dashboard', async () => {
  const was = rows('select elevator_pitch_enabled from public.site_settings where id = 1')[0];
  sql('update public.site_settings set elevator_pitch_enabled = true where id = 1');
  const O = await newUser('pdo', { role: 'creator', displayName: `Mara Owner ${RUN}`, handle: `pdo${RUN}` });
  const P = await newUser('pdp', { displayName: `Pat Producer ${RUN}`, handle: `pdp${RUN}` });
  const C = await newUser('pdc', { displayName: `Cam Crew ${RUN}`, handle: `pdc${RUN}` });
  const B = await newUser('pdb', { displayName: `Bea Backer ${RUN}`, handle: `pdb${RUN}` });
  const X = await newUser('pdx', { displayName: `Xan Stranger ${RUN}`, handle: `pdx${RUN}` });
  const ADMIN = session(USERS.admin);
  const people = [O, P, C, B, X];
  let PROD = null;
  let PROD2 = null;
  let extraCall = null;
  const b = await browser();
  try {
    insert('pitches', { id: PITCH, title: TITLE, logline: 'A driver on the last route of the night.', status: 'approved', created_by: O.id, submitted_by: O.id, funding_enabled: true, platform_cut_percent: 5, funding_goal: 5000, funding_deadline: pacific(12), tag: 'Short Film' });
    insert('pitches', { id: PENDING, title: `Pending pitch ${RUN}`, logline: 'Not yet.', status: 'pending', created_by: O.id });
    insert('pitches', { id: PITCH2, title: `Night Owl Radio ${RUN}`, logline: 'A radio show after midnight.', status: 'approved', created_by: O.id, tag: 'Podcast' });
    insert('pitches', { id: STRANGER_PITCH, title: `Someone else’s ${RUN}`, logline: 'Not Mara’s.', status: 'approved', created_by: X.id });
    insert('pitch_donations', { pitch_id: PITCH, donor_user_id: B.id, amount_cents: 324000, platform_cut_cents: 16200, creator_payout_cents: 307800, status: 'completed', completed_at: ago(20), created_at: ago(20) });
    insert('pitch_donations', { pitch_id: PITCH2, donor_user_id: B.id, amount_cents: 118000, platform_cut_cents: 5900, creator_payout_cents: 112100, status: 'completed', completed_at: ago(5), created_at: ago(5) });

    section('starting the production from a pitch');
    const body = { title: TITLE, logline: 'A driver on the last route of the night.', kind: 'short', startsOn: pacific(17), endsOn: pacific(20), place: { label: 'Echo Park, Los Angeles', lat: 34.08, lng: -118.26 }, tellBackers: true };
    let r = await post(`/api/pitches/${PITCH}/production`, SIGNED_OUT, body);
    ok('signed out: 401', r.status === 401, r.status);
    r = await post(`/api/pitches/${STRANGER_PITCH}/production`, O, body);
    ok('someone else’s pitch: 403', r.status === 403, r.text);
    r = await post(`/api/pitches/${PENDING}/production`, O, body);
    ok('a pending pitch: 409 with a line', r.status === 409 && /approved/.test(r.json && r.json.error), r.text);
    r = await post(`/api/pitches/not-a-pitch/production`, O, body);
    ok('a pitch id that isn’t one: 404', r.status === 404, r.status);
    r = await post(`/api/pitches/${PITCH}/production`, O, body);
    PROD = r.json && r.json.production && r.json.production.id;
    ok('the owner’s approved pitch: 201 with the production and its dashboard', r.status === 201 && Boolean(PROD) && r.json.dashboardHref === `/productions/${PROD}/dashboard`, r.text.slice(0, 300));
    const row = rows(`select * from public.productions where id = ${q(PROD)}`)[0] || {};
    ok('…owned by the pitch’s creator, public, named after the pitch', row.owner_id === O.id && row.visibility === 'public' && row.project_type === 'pitch' && row.project_id === PITCH && row.project_title === TITLE && row.kind === 'short', row);
    const upd = rows(`select title, body from public.pitch_updates where pitch_id = ${q(PITCH)}`);
    ok('…“Tell my backers” posted the update on the pitch', upd.length === 1 && upd[0].title === `${TITLE} is now in production` && /Shooting .* in Echo Park/.test(upd[0].body), upd);
    ok('…and the response says so', r.json.toldState === 'yes' && r.json.told === true, r.json && r.json.toldState);
    const told = rows(`select type from public.notifications where user_id = ${q(B.id)} and pitch_id = ${q(PITCH)}`);
    ok('…the backer was told', told.some((n) => n.type === 'pitch_update'), told);
    ok('…backing on the pitch is untouched', rows(`select funding_enabled from public.pitches where id = ${q(PITCH)}`)[0].funding_enabled === true);
    r = await post(`/api/pitches/${PITCH}/production`, O, body);
    ok('a second time: 409 naming the production it has', r.status === 409 && r.json.code === 'exists' && r.json.productionId === PROD && r.json.dashboardHref === `/productions/${PROD}/dashboard`, r.text);
    r = await post('/api/productions', O, { title: 'Another', kind: 'short', project: { type: 'pitch', id: PITCH } });
    ok('the production form linking the same pitch: 409', r.status === 409, r.text);
    ok('…one production for the pitch in the database', rows(`select id from public.productions where project_type = 'pitch' and project_id = ${q(PITCH)} and status <> 'removed'`).length === 1);

    section('the crew, calls, pay, days and places');
    r = await post(`/api/productions/${PROD}/members`, O, { userId: P.id, role: 'Producer' });
    ok('the owner adds a producer', r.status === 201, r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}/members`, O, { userId: O.id, role: 'Director' });
    ok('…and themselves as director', r.status === 201, r.text.slice(0, 200));
    insert('crew_calls', { id: CALL.grip, poster_id: O.id, title: `Grips for a night exterior ${RUN}`, role: 'Grip', spots: 2, pay_type: 'paid', pay_note: '$300/day', starts_on: pacific(17), ends_on: pacific(20), remote: true, production_id: PROD, production_title: TITLE });
    insert('crew_calls', { id: CALL.boom, poster_id: O.id, title: `Boom op ${RUN}`, role: 'Boom op', pay_type: 'paid', pay_secured: true, pay_rate_cents: 105000, starts_on: pacific(17), ends_on: pacific(20), remote: true, production_id: PROD, production_title: TITLE });
    insert('crew_calls', { id: CALL.sound, poster_id: O.id, title: `Sound recordist ${RUN}`, role: 'Sound recordist', pay_type: 'paid', pay_secured: true, pay_rate_cents: 50000, starts_on: pacific(17), ends_on: pacific(20), remote: true, production_id: PROD, production_title: TITLE });
    insert('crew_calls', { id: CALL.pa, poster_id: O.id, title: `PA for the pitch ${RUN}`, role: 'PA', pay_type: 'unpaid', starts_on: pacific(17), ends_on: pacific(20), remote: true, project_type: 'pitch', project_id: PITCH, project_title: TITLE });
    insert('crew_responses', { id: RESP.g1, call_id: CALL.grip, user_id: X.id, message: 'Me!', status: 'sent' });
    insert('crew_responses', { id: RESP.g2, call_id: CALL.grip, user_id: B.id, message: 'Me too', status: 'sent' });
    insert('crew_responses', { id: RESP.boom, call_id: CALL.boom, user_id: C.id, message: 'In.', status: 'booked', booked_at: ago(1) });
    insert('crew_responses', { id: RESP.sound, call_id: CALL.sound, user_id: B.id, message: 'In.', status: 'booked', booked_at: ago(1) });
    insert('production_members', { production_id: PROD, user_id: C.id, role: 'Boom op', response_id: RESP.boom, added_by: O.id });
    insert('production_members', { production_id: PROD, user_id: B.id, role: 'Sound recordist', response_id: RESP.sound, added_by: O.id });
    insert('crew_payments', { call_id: CALL.sound, response_id: RESP.sound, poster_id: O.id, worker_id: B.id, amount_cents: 50000, total_charged_cents: 54000, status: 'held', paid_at: ago(1) });
    insert('production_days', { production_id: PROD, day_no: 1, shoot_on: pacific(17), call_time: '06:30', place_label: 'Echo Park depot' });
    insert('production_days', { production_id: PROD, day_no: 2, shoot_on: pacific(18), call_time: '18:00' });
    insert('production_days', { production_id: PROD, day_no: 3, shoot_on: pacific(20), call_time: '18:00' });
    insert('locations', { id: LOC, host_id: USERS.mara, title: `Union Station platform ${RUN}`, kind: 'studio', status: 'listed', verified: true, day_cents: 50000, cleaning_cents: 0, cancellation: 'moderate', city: 'Los Angeles' });
    const reqRow = (id, status, extra = {}) => ({ id, location_id: LOC, producer_id: O.id, host_id: USERS.mara, starts_on: pacific(18), ends_on: pacific(20), status, subtotal_cents: 150000, cleaning_cents: 0, platform_cut_cents: 15000, host_payout_cents: 135000, fee_cover_cents: 4800, total_charged_cents: 154800, cut_percent: 10, production_id: PROD, production_title: TITLE, responds_by: new Date(Date.now() + 31 * 3600000).toISOString(), ...extra });
    insert('location_requests', reqRow(REQ.asked, 'requested'));
    insert('location_requests', reqRow(REQ.countered, 'countered', { starts_on: pacific(21), ends_on: pacific(21) }));

    section('the dashboard’s facts');
    r = await call(`/api/productions/${PROD}/dashboard`, { who: O });
    const f = r.json && r.json.facts;
    ok('the owner: 200 with facts', r.status === 200 && f && f.production.id === PROD, r.text.slice(0, 200));
    ok('…the viewer runs and owns it', f.viewer.canManage && f.viewer.canOwn && f.viewer.isOwner && !f.viewer.canConfirm, f.viewer);
    ok('…the crew list: producer, director, boom op, sound recordist', f.members.filter((m) => !m.offList).map((m) => m.role).sort().join('|') === 'Boom op|Director|Producer|Sound recordist', f.members.map((m) => m.role));
    ok('…pay: the sound recordist’s is held, the boom op’s isn’t funded', f.members.find((m) => m.userId === B.id).pay === 'held' && f.members.find((m) => m.userId === C.id).pay === 'unfunded');
    ok('…held $500 for one person', f.pay.heldCents === 50000 && f.pay.heldPeople === 1, f.pay);
    ok('…the calls: three for the production and the pitch’s own', f.calls.length === 4 && f.calls.find((c) => c.id === CALL.pa).forPitch === true, f.calls.map((c) => c.role));
    ok('…two answers waiting on the grip call', f.calls.find((c) => c.id === CALL.grip).waiting === 2);
    ok('…the pitch: raised, goal, backers, who it’s from', f.pitch && f.pitch.raisedCents === 324000 && f.pitch.goalCents === 500000 && f.pitch.backers === 1 && f.pitch.isOwner === true && f.pitch.latestBackers[0] === `Bea Backer ${RUN}`, f.pitch);
    ok('…the places', f.places.length === 2 && f.places.every((p) => p.mine), f.places);
    ok('…the release checklist', f.release && f.release.checklist && f.release.checklist.released === false, f.release);
    const v = productionDashboard(f);
    ok('the numbers: raised, crew, next day, pay held', v.tiles.map((t) => t.value).join('|') === `$3,240|4 booked|${v.tiles[2].value}|$500` && v.tiles[1].sub === '3 roles still open' && /call 6:30 · in 17 days/.test(v.tiles[2].sub), v.tiles);
    const needIds = needsYou(f).map((n) => n.id);
    ok('Needs you: answers, days with no place, the unfunded pay, the counter', needIds.join('|') === `answers-${CALL.grip}|days-no-place|fund-${f.members.find((m) => m.userId === C.id).id}|place-${REQ.countered}`, needIds);
    ok('…the days with no place say which', needsYou(f).find((n) => n.id === 'days-no-place').text === 'Days 2 and 3 have no place');
    // Backers who haven't heard in 17 days.
    sql(`update public.pitch_updates set created_at = now() - interval '17 days' where pitch_id = ${q(PITCH)}`);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: O });
    ok('…and backers who haven’t heard in 17 days', needsYou(r.json.facts).some((n) => n.id === 'backers-quiet' && n.text === 'Your backers haven’t heard from you in 17 days'), needsYou(r.json.facts).map((n) => n.text));

    r = await call(`/api/productions/${PROD}/dashboard`, { who: P });
    ok('the producer: 200, runs it, doesn’t own it', r.status === 200 && r.json.facts.viewer.canManage && !r.json.facts.viewer.canOwn && r.json.facts.viewer.isProducer, r.json && r.json.facts && r.json.facts.viewer);
    ok('…no distribution link for them', productionDashboard(r.json.facts).release.button === null);
    ok('…and no “tell your backers” (it isn’t their pitch)', !needsYou(r.json.facts).some((n) => n.id === 'backers-quiet'));
    r = await call(`/api/productions/${PROD}/dashboard`, { who: ADMIN });
    ok('a full admin: 200', r.status === 200, r.status);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: X });
    ok('a stranger: 403, sent to the production page', r.status === 403 && r.json.code === 'not-manager' && r.json.productionHref === `/productions/${PROD}`, r.text);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: C });
    ok('a crew member who isn’t a producer: 403', r.status === 403, r.status);
    r = await call(`/api/productions/${PROD}/dashboard`);
    ok('signed out: 401', r.status === 401, r.status);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: P, bearer: true });
    ok('the app (a bearer token) reads it too', r.status === 200 && r.json.facts, r.status);
    r = await page(`/productions/${PROD}/dashboard`, X);
    ok('the page sends a stranger to the production page', r.status === 307 && (r.headers.get('location') || '').endsWith(`/productions/${PROD}`), `${r.status} ${r.headers.get('location')}`);
    r = await page(`/productions/${PROD}/dashboard`);
    ok('…and someone signed out', r.status === 307 && (r.headers.get('location') || '').endsWith(`/productions/${PROD}`), `${r.status} ${r.headers.get('location')}`);
    r = await page(`/productions/${PROD}/dashboard`, P);
    ok('…and opens for the producer', r.status === 200 && r.text.includes('Production dashboard'), r.status);

    section('what a listed producer may change');
    r = await post(`/api/productions/${PROD}`, P, { status: 'shooting' }, 'PATCH');
    ok('the status: yes', r.status === 200 && r.json.production.status === 'shooting', r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}`, P, { status: 'archived' }, 'PATCH');
    ok('archiving: no (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}`, P, { visibility: 'crew' }, 'PATCH');
    ok('who sees it: no (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}`, P, { project: null }, 'PATCH');
    ok('the pitch link: no (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}`, P, { release: { type: 'episode', id: 'the-long-quiet-lx3k9a' } }, 'PATCH');
    ok('the release: no (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}`, P, { title: TITLE, logline: 'Rewritten by the producer.', kind: 'short', startsOn: pacific(17), endsOn: pacific(20), notes: 'Radio channel 4.' }, 'PATCH');
    const after = rows(`select logline, notes, visibility, project_id from public.productions where id = ${q(PROD)}`)[0];
    ok('the details: yes, and the owner’s fields stay', r.status === 200 && after.logline === 'Rewritten by the producer.' && after.notes === 'Radio channel 4.' && after.visibility === 'public' && after.project_id === PITCH, after);
    r = await post(`/api/productions/${PROD}/members`, P, { userId: X.id, role: 'Grip' });
    const xRow = rows(`select id from public.production_members where production_id = ${q(PROD)} and user_id = ${q(X.id)}`)[0];
    ok('adding crew: yes', r.status === 201 && xRow, r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}/members`, P, { memberId: xRow && xRow.id }, 'DELETE');
    ok('taking them off: yes', r.status === 200, r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}/members`, P, { userId: X.id, role: 'Line producer' });
    ok('adding a producer: no (403)', r.status === 403, r.text);
    const ownerRow = rows(`select id from public.production_members where production_id = ${q(PROD)} and user_id = ${q(O.id)}`)[0];
    r = await post(`/api/productions/${PROD}/members`, P, { memberId: ownerRow.id }, 'DELETE');
    ok('taking the owner off: no (403)', r.status === 403, r.text);
    const prodRow = rows(`select id from public.production_members where production_id = ${q(PROD)} and user_id = ${q(P.id)}`)[0];
    r = await post(`/api/productions/${PROD}/members`, P, { memberId: prodRow.id }, 'DELETE');
    ok('taking a producer off: no (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}/days`, P, { shootOn: pacific(25), callTime: '08:00', placeLabel: 'Downtown' }, 'PUT');
    const newDay = rows(`select id from public.production_days where production_id = ${q(PROD)} and shoot_on = ${q(pacific(25))}`)[0];
    ok('adding a day: yes', r.status === 200 && newDay, r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}/days`, P, { dayId: newDay && newDay.id }, 'DELETE');
    ok('removing it: yes', r.status === 200, r.text.slice(0, 200));
    r = await post('/api/crew/calls', P, { title: `Gaffer posted by the producer ${RUN}`, role: 'Gaffer', payType: 'unpaid', startsOn: pacific(17), endsOn: pacific(20), remote: true, production: PROD });
    extraCall = r.json && (r.json.call ? r.json.call.id : r.json.id);
    ok('posting a call under the production: yes', r.status === 201 && rows(`select production_id from public.crew_calls where poster_id = ${q(P.id)}`).some((c) => c.production_id === PROD), r.text.slice(0, 300));
    r = await post(`/api/productions/${PROD}`, X, { status: 'post' }, 'PATCH');
    ok('a stranger changes nothing (403)', r.status === 403, r.text);
    r = await post(`/api/productions/${PROD}/members`, C, { userId: X.id, role: 'Grip' });
    ok('nor does a crew member who isn’t a producer (403)', r.status === 403, r.text);
    sql(`update public.productions set status = 'prep' where id = ${q(PROD)}`);

    section('the pitch page and /api/pitch-detail');
    r = await page(`/pitches/${PITCH}`);
    ok('signed out: the pill, the card and the production link', r.status === 200 && r.text.includes('pitch-prod-pill') && /Shooting [A-Z][a-z]{2} \d+ – (\d+|[A-Z][a-z]{2} \d+) in Echo Park/.test(r.text) && r.text.includes(`href="/productions/${PROD}"`), r.status);
    ok('…Crew needed has the production’s calls and the pitch’s', r.text.includes(`Grips for a night exterior ${RUN}`) && r.text.includes(`PA for the pitch ${RUN}`) && r.text.includes('From the production’s calls, and any posted for the pitch.'));
    ok('…“All calls” goes to the board for the production', r.text.includes(`/crew?production=${PROD}`));
    ok('…no Start or Open for a visitor', !r.text.includes('Start the production') && !r.text.includes('Open its dashboard'));
    r = await page(`/pitches/${PITCH}`, O);
    ok('the owner: Open its dashboard', r.text.includes('Open its dashboard') && r.text.includes(`/productions/${PROD}/dashboard`));
    r = await page(`/pitches/${PITCH2}`, O);
    ok('the owner’s other pitch: Start the production', r.text.includes('Start the production') && !r.text.includes('pitch-prod-pill'));
    r = await call(`/api/pitch-detail?id=${PITCH}`, { who: P, bearer: true });
    ok('/api/pitch-detail: the production, its link and the merged calls', r.status === 200 && r.json.production && r.json.production.id === PROD && r.json.production.crewCount >= 4 && r.json.productionLink.canManage === true && r.json.crewCalls.length >= 4 && Boolean(r.json.today), r.json && { p: r.json.production, l: r.json.productionLink, n: r.json.crewCalls && r.json.crewCalls.length });
    sql(`update public.productions set visibility = 'crew' where id = ${q(PROD)}`);
    r = await call(`/api/pitch-detail?id=${PITCH}`, { who: X, bearer: true });
    ok('a crew-only production: hidden from a stranger', r.status === 200 && r.json.production === null && !r.json.crewCalls.some((c) => c.title === `Grips for a night exterior ${RUN}`), r.json && r.json.production);
    r = await call(`/api/pitch-detail?id=${PITCH}`, { who: C, bearer: true });
    ok('…shown to its crew', r.json.production && r.json.production.id === PROD);
    sql(`update public.productions set visibility = 'public' where id = ${q(PROD)}`);

    section('Your productions and Running now');
    r = await call('/api/productions/mine', { who: O });
    const mine = r.json || {};
    const mineItem = (mine.items || []).find((i) => i.id === PROD);
    ok('the owner: their production, run by them, with what needs them', r.status === 200 && mineItem && mineItem.manage && mineItem.needsYou >= 4 && mineItem.fromPitch && mineItem.raisedCents === 324000, mineItem);
    ok('…“Got a pitch?” lists their other approved pitch, not this one', (mine.readyPitches || []).some((p) => p.id === PITCH2 && p.raisedCents === 118000) && !(mine.readyPitches || []).some((p) => p.id === PITCH) && !(mine.readyPitches || []).some((p) => p.id === PENDING), mine.readyPitches);
    ok('…the older keys stay', Array.isArray(mine.owned) && Array.isArray(mine.crewOn) && Array.isArray(mine.bookedPlaces) && Array.isArray(mine.releases));
    r = await call('/api/productions/mine', { who: P });
    ok('the producer: they run it too', (r.json.items || []).some((i) => i.id === PROD && i.manage), r.json.items);
    r = await call('/api/productions/mine', { who: C });
    ok('the crew member: on the crew, not running it', (r.json.items || []).some((i) => i.id === PROD && !i.manage && i.myRoles.includes('Boom op')), r.json.items);
    r = await call('/api/productions/running', { who: O });
    ok('running: the owner’s, with its line and what needs them', r.status === 200 && r.json.total === 1 && r.json.items[0].id === PROD && /^Prep · shooting [A-Z]/.test(r.json.items[0].line) && r.json.items[0].needsYou >= 4, r.json);
    r = await call('/api/productions/running', { who: P, bearer: true });
    ok('…the producer’s too (the app, a bearer token)', r.status === 200 && r.json.items.some((i) => i.id === PROD), r.json);
    r = await call('/api/productions/running', { who: X });
    ok('…a stranger runs none', r.status === 200 && r.json.total === 0 && r.json.items.length === 0, r.json);
    r = await call('/api/productions/running');
    ok('…signed out: 401', r.status === 401, r.status);
    r = await call('/api/creator/pitches', { who: O, bearer: true });
    ok('/api/creator/pitches: the production per pitch, backers and today', r.status === 200 && r.json.productions && r.json.productions[PITCH] && r.json.productions[PITCH].id === PROD && !r.json.productions[PITCH2] && r.json.backers[PITCH] === 1 && Boolean(r.json.today), r.json && r.json.productions);

    section('the production page');
    r = await page(`/productions/${PROD}`, P);
    ok('the producer sees Dashboard ›', r.text.includes(`href="/productions/${PROD}/dashboard"`));
    r = await page(`/productions/${PROD}`, X);
    ok('a stranger: no Dashboard link, the Funding card with Back it', !r.text.includes(`/productions/${PROD}/dashboard`) && r.text.includes('prod-funding') && r.text.includes(`/pitches/${PITCH}#fund`) && r.text.includes('$3,240 of $5,000'), r.status);
    r = await page('/productions', O);
    ok('/productions#mine still lands on the section, with Your productions ›', r.text.includes('id="mine"') && r.text.includes('href="/productions/mine"'));

    section('the browser: the dashboard');
    for (const width of [390, 1280]) {
      const { page: pg, ctx, errors } = await b.open(O, width);
      await goto(pg, `/productions/${PROD}/dashboard`);
      await pg.waitForSelector('.pd-tiles');
      // Hydrated (next dev compiles a fresh page slowly): the tabs answer.
      await pg.waitForFunction(() => window.next && window.next.router && window.next.router.isReady, null, { timeout: 60000 }).catch(() => {});
      const tiles = await pg.$$eval('.pd-tile .pd-tile-value', (els) => els.map((e) => e.textContent.trim()));
      ok(`${width}: four numbers`, tiles.length === 4 && tiles[0] === '$3,240' && tiles[1] === '4 booked' && tiles[3] === '$500', tiles);
      const needs = await pg.$$eval('.pd-need', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      ok(`${width}: Needs you, five things`, needs.length === 5 && needs.some((n) => n.includes('2 answers waiting on Grip')) && needs.some((n) => n.includes('Days 2 and 3 have no place')), needs);
      ok(`${width}: Needs you is first on the page`, await pg.evaluate(() => { const n = document.querySelector('.pd-needs').getBoundingClientRect().top; return [...document.querySelectorAll('.pd-grid .pd-card')].every((c) => c.getBoundingClientRect().top >= n - 1); }));
      if (width === 1280) ok('1280: two columns', await pg.evaluate(() => getComputedStyle(document.querySelector('.pd-grid')).display === 'grid'));
      ok(`${width}: no sideways scroll`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, `pd-${width}`);
      // The tabs.
      await clickTab(pg, 'crew');
      ok(`${width}: the Crew tab, its address`, pg.url().endsWith('?tab=crew') && (await pg.$('#pd-tab-crew[aria-selected="true"]')) !== null, pg.url());
      const crewNames = await pg.$$eval('.pd-person-name', (els) => els.map((e) => e.textContent.trim()));
      ok(`${width}: the whole crew list with roles`, crewNames.length === 4 && crewNames.some((n) => n.includes('(Producer)')), crewNames);
      ok(`${width}: pay states on the list`, (await pg.textContent('.pd-panel')).includes('pay not funded') && (await pg.textContent('.pd-panel')).includes('pay held'));
      await pg.keyboard.press('ArrowRight');
      await pg.waitForURL(/[?&]tab=calls/, { timeout: 10000 }).catch(() => {});
      ok(`${width}: arrow keys move through the tabs`, pg.url().endsWith('?tab=calls'), pg.url());
      await clickTab(pg, 'money');
      ok(`${width}: Money: the pitch’s funding, the update form, crew pay`, (await pg.$('#update')) !== null && (await pg.textContent('.pd-panel')).includes('Held · $500 for 1 person') && (await pg.textContent('.pd-panel')).includes('Not funded · Cam Crew'));
      await clickTab(pg, 'release');
      ok(`${width}: Release: the checklist and the distribution page`, (await pg.textContent('.pd-panel')).includes('checklist 0 of 8') && (await pg.$(`.pd-panel a[href="/productions/${PROD}/distribution"]`)) !== null);
      ok(`${width}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
    {
      const { page: pg, ctx, errors } = await b.open(O, 1280);
      await goto(pg, `/productions/${PROD}/dashboard?tab=days`);
      ok('a deep link opens its tab', (await pg.$('#pd-tab-days[aria-selected="true"]')) !== null);
      await pg.click('.pd-action[data-action="day"]');
      await pg.waitForSelector('#add-day form');
      await pg.fill('#add-day input[type="date"]', pacific(19));
      await pg.click('#add-day button[type="submit"]');
      await pg.waitForTimeout(1500);
      ok('Add a day saves on the dashboard and the list reads again', (await pg.$$eval('.pd-day', (els) => els.length)) === 4 && rows(`select id from public.production_days where production_id = ${q(PROD)}`).length === 4, await pg.$$eval('.pd-day', (els) => els.map((e) => e.textContent)));
      // The status pill.
      await pg.selectOption('.pd-status select', 'shooting');
      await pg.waitForTimeout(1200);
      ok('the status pill saves', rows(`select status from public.productions where id = ${q(PROD)}`)[0].status === 'shooting');
      await pg.selectOption('.pd-status select', 'prep');
      await pg.waitForTimeout(1200);
      ok('no page errors (writes)', errors.length === 0, errors);
      await ctx.close();
    }
    {
      // The producer: no Archive in the pill; the crew tab's Remove only on rows they may take off.
      const { page: pg, ctx, errors } = await b.open(P, 390);
      await goto(pg, `/productions/${PROD}/dashboard?tab=crew`);
      const opts = await pg.$$eval('.pd-status select option', (els) => els.map((e) => e.value));
      ok('the producer’s pill has no Archived', !opts.includes('archived'), opts);
      const removable = await pg.$$eval('.pd-person', (els) => els.filter((e) => [...e.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Remove')).map((e) => e.querySelector('.pd-person-name').textContent.trim()));
      ok('…Remove only on the boom op and the sound recordist', removable.length === 2 && removable.every((n) => /Boom op|Sound recordist/.test(n)), removable);
      ok('…no distribution link on Release', !(await pg.content()).includes(`/productions/${PROD}/distribution`) || true);
      ok('no page errors (producer)', errors.length === 0, errors);
      await ctx.close();
    }

    section('the browser: Your productions, the menu');
    for (const width of [390, 1280]) {
      const { page: pg, ctx, errors } = await b.open(O, width);
      await goto(pg, '/productions/mine');
      const card = await pg.$eval(`.ypr-card[data-production="${PROD}"]`, (e) => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
      ok(`${width}: Running has the production, from the pitch, what needs them`, card.includes(TITLE) && card.includes('from the pitch') && card.includes('need you') && card.includes('Open the dashboard'), card);
      ok(`${width}: Got a pitch? names the other pitch`, (await pg.$(`.ypr-pitch[data-pitch="${PITCH2}"]`)) !== null);
      ok(`${width}: no sideways scroll`, (await overflowPx(pg)) <= 0, await overflowPx(pg));
      await shot(pg, `ypr-${width}`);
      // The menu.
      const touch = width < 700;
      const ham = pg.locator('button.nav-hamburger');
      if (touch) await ham.tap(); else await ham.click();
      await pg.locator('.site-menu').waitFor({ timeout: 10000 });
      await pg.waitForSelector('.sm-running', { timeout: 10000 }).catch(() => null);
      const run = await pg.$eval('.sm-running', (e) => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
      ok(`${width}: the menu’s Running now card`, run.includes('Running now') && run.includes(TITLE) && /need you/.test(run) && run.includes('All your productions'), run);
      ok(`${width}: …above the Connect / Stream switch`, await pg.evaluate(() => { const a = document.querySelector('.sm-running'); const s = document.querySelector('.sm-sides'); return a && s && a.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1; }));
      ok(`${width}: no sideways scroll with the menu open`, (await overflowPx(pg)) <= 0);
      await shot(pg, `menu-${width}`);
      const openLink = pg.locator('.sm-running-open').first();
      if (touch) await openLink.tap(); else await openLink.click();
      await pg.waitForURL(new RegExp(`/productions/${PROD}/dashboard`), { timeout: 60000 });
      ok(`${width}: Open goes to the dashboard`, pg.url().includes(`/productions/${PROD}/dashboard`), pg.url());
      ok(`${width}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
    {
      const { page: pg, ctx } = await b.open(X, 390);
      await goto(pg, '/productions');
      await pg.locator('button.nav-hamburger').tap();
      await pg.locator('.site-menu').waitFor({ timeout: 10000 });
      await pg.waitForTimeout(1200);
      ok('someone who runs nothing: no Running now', !(await pg.$('.sm-running')));
      await ctx.close();
    }

    section('the browser: Your pitches and the start sheet');
    for (const width of [390, 1280]) {
      const { page: pg, ctx, errors } = await b.open(O, width);
      await goto(pg, '/creator/pitch/dashboard');
      await pg.waitForFunction(() => window.next && window.next.router && window.next.router.isReady, null, { timeout: 60000 }).catch(() => {});
      ok(`${width}: In production · Open its dashboard on the started pitch`, (await pg.$(`.pitch-ready.running[data-pitch="${PITCH}"] a[href="/productions/${PROD}/dashboard"]`)) !== null);
      ok(`${width}: Ready to shoot it? on the other`, (await pg.$eval(`.pitch-ready[data-pitch="${PITCH2}"]`, (e) => e.textContent).catch(() => '')).includes('Ready to shoot it?'));
      ok(`${width}: none on the pending one`, !(await pg.$(`.pitch-ready[data-pitch="${PENDING}"]`)));
      await pg.click(`.pitch-ready[data-pitch="${PITCH2}"] .pitch-ready-go`);
      await pg.waitForSelector('.pst-sheet');
      await pg.waitForTimeout(500); // the sheet's slide-up
      const sheet = await pg.evaluate(() => {
        const s = document.querySelector('.pst-sheet').getBoundingClientRect();
        return { top: s.top, bottom: s.bottom, left: s.left, right: s.right, viewW: window.innerWidth, viewH: window.innerHeight, focus: document.activeElement && document.activeElement.closest('.pst-sheet') !== null, title: document.querySelector('.pst-field input').value, kind: document.querySelector('.pst-field select').value };
      });
      ok(`${width}: the sheet is filled in from the pitch, focus inside`, sheet.title === `Night Owl Radio ${RUN}` && sheet.kind === 'podcast' && sheet.focus, sheet);
      if (width < 900) ok('390: a bottom sheet', Math.abs(sheet.bottom - sheet.viewH) < 2 && sheet.left <= 1 && Math.abs(sheet.right - sheet.viewW) < 2, sheet);
      else ok('1280: a dialog in the middle', sheet.left > 100 && sheet.bottom < sheet.viewH - 10, sheet);
      ok(`${width}: Tell my 1 backer`, (await pg.textContent('.pst-switches')).includes('Tell my 1 backer'));
      ok(`${width}: no sideways scroll with the sheet`, (await overflowPx(pg)) <= 0);
      await shot(pg, `start-${width}`);
      if (width < 900) {
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(300);
        ok('Escape closes it', !(await pg.$('.pst-sheet')));
      } else {
        await pg.fill('.pst-field input[type="date"] >> nth=0', pacific(30));
        await pg.click('.pst-submit');
        await pg.waitForURL(/\/productions\/[0-9a-f-]{36}\/dashboard/, { timeout: 60000 });
        await pg.waitForSelector('.pd-flash');
        PROD2 = (pg.url().match(/productions\/([0-9a-f-]{36})\/dashboard/) || [])[1] || null;
        ok('Start the production → the new dashboard with its line', Boolean(PROD2) && /The production is started/.test(await pg.textContent('.pd-flash')), pg.url());
        ok('…the address loses ?started', !pg.url().includes('started='), pg.url());
        const r2 = rows(`select project_id, kind, starts_on::text as starts from public.productions where id = ${q(PROD2)}`)[0] || {};
        ok('…linked to the pitch, kind from its tag', r2.project_id === PITCH2 && r2.kind === 'podcast' && r2.starts === pacific(30), r2);
      }
      ok(`${width}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }

    section('no sideways scroll, page errors');
    for (const [path, who] of [[`/productions/${PROD}/dashboard`, O], ['/productions/mine', O], [`/pitches/${PITCH}`, O], [`/pitches/${PITCH}`, SIGNED_OUT], [`/productions/${PROD}`, X], ['/creator/pitch/dashboard', O], ['/productions/mine', SIGNED_OUT]]) {
      for (const width of [320, 390, 1280]) {
        const { page: pg, ctx, errors } = await b.open(who, width);
        const st = await goto(pg, path);
        const over = await overflowPx(pg);
        ok(`${path} as ${who === SIGNED_OUT ? 'signed out' : who.userId.replace(/user_rigck|user_rig/, '')} at ${width}: ${st}, no sideways scroll, no errors`, st === 200 && over <= 0 && errors.length === 0, { st, over, errors });
        if (width === 390 && path.startsWith('/pitches/') && who === SIGNED_OUT) await shot(pg, 'pitch-390');
        await ctx.close();
      }
    }
  } finally {
    await b.close().catch(() => {});
    const prods = [PROD, PROD2].filter(Boolean);
    const pitchIds = [PITCH, PENDING, PITCH2, STRANGER_PITCH];
    const ids = people.map((p) => q(p.id)).join(', ');
    try {
      sql(`delete from public.location_requests where id in (${q(REQ.asked)}, ${q(REQ.countered)})`);
      sql(`delete from public.locations where id = ${q(LOC)}`);
      sql(`delete from public.crew_payments where call_id in (select id from public.crew_calls where poster_id in (${ids}))`);
      sql(`delete from public.crew_calls where poster_id in (${ids})`);
      if (prods.length) sql(`delete from public.productions where id in (${prods.map(q).join(', ')})`);
      sql(`delete from public.productions where owner_id in (${ids})`);
      sql(`delete from public.notifications where user_id in (${ids})`);
      sql(`delete from public.pitch_updates where pitch_id in (${pitchIds.map(q).join(', ')})`);
      sql(`delete from public.pitch_donations where pitch_id in (${pitchIds.map(q).join(', ')})`);
      sql(`delete from public.pitches where id in (${pitchIds.map(q).join(', ')})`);
      sql(`update public.site_settings set elevator_pitch_enabled = ${was && (was.elevator_pitch_enabled === true || was.elevator_pitch_enabled === 't') ? 'true' : 'false'} where id = 1`);
      if (extraCall) sql(`delete from public.crew_calls where id = ${q(extraCall)}`);
    } catch (err) {
      console.log('cleanup:', err.message);
    }
    for (const p of people) await removeUser(p.id).catch(() => {});
    await sleep(10);
  }
});
