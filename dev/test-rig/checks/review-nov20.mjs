#!/usr/bin/env node
// The fixes from the review of 2026-11-20 (account types, yearly plans,
// productions from pitches), end to end:
//   one production per pitch holds when the pitch id is written in capitals
//   or without its dashes (create and edit), and the stored link is the
//   pitch's own id;
//   the production dashboard tells someone who doesn't run it no more than
//   the production page does (a held, private or crew-only production isn't
//   there), and the people running a held one get its hold line;
//   a listed producer changes nothing on a held production (the owner still
//   can), can't add someone either of them blocked, and a held production
//   takes no new calls;
//   a full admin who doesn't run a production isn't offered Post a call or
//   Find a place on its dashboard;
//   Your productions lists a private production only to the people running
//   it, not to plain crew;
//   a release that isn't public any more is named on the dashboard only to
//   the owner;
//   /api/my-role gives the ☰ menu its account types for someone with no
//   profile row yet.
//   node dev/test-rig/checks/review-nov20.mjs
import crypto from 'node:crypto';
import { RUN, USERS, SIGNED_OUT, ok, section, runCheck, rows, sql, q, call, session, newUser, removeUser, insert } from './lib.mjs';
import { productionDashboard } from '../../../lib/productionDashRules.js';

const uuid = () => crypto.randomUUID();
const PITCH = uuid();
const post = (path, who, body, method = 'POST') => call(path, { who, method, body, headers: { Origin: 'http://localhost:3100' } });
const pacific = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));

await runCheck('review-nov20', async () => {
  const was = rows('select elevator_pitch_enabled from public.site_settings where id = 1')[0];
  sql('update public.site_settings set elevator_pitch_enabled = true where id = 1');
  const O = await newUser('rvo', { role: 'creator', displayName: `Ola Owner ${RUN}`, handle: `rvo${RUN}` });
  const P = await newUser('rvp', { displayName: `Pia Producer ${RUN}`, handle: `rvp${RUN}` });
  const C = await newUser('rvc', { displayName: `Cy Crew ${RUN}`, handle: `rvc${RUN}` });
  const X = await newUser('rvx', { displayName: `Xu Stranger ${RUN}`, handle: `rvx${RUN}` });
  const T = await newUser('rvt', { displayName: `Tam Blocker ${RUN}`, handle: `rvt${RUN}` });
  const N = await newUser('rvn', { displayName: `New Person ${RUN}`, handle: `rvn${RUN}` });
  const ADMIN = session(USERS.admin);
  const people = [O, P, C, X, T, N];
  let PROD = null;
  let call1 = null;
  try {
    insert('pitches', { id: PITCH, title: `Review pitch ${RUN}`, logline: 'One production only.', status: 'approved', created_by: O.id, submitted_by: O.id, tag: 'Short Film' });

    section('One production per pitch, however the pitch id is written');
    let r = await post(`/api/pitches/${PITCH}/production`, O, { title: `Review ${RUN}`, kind: 'short', startsOn: pacific(20), endsOn: pacific(21) });
    PROD = r.json && r.json.production && r.json.production.id;
    ok('the production starts from the pitch', r.status === 201 && Boolean(PROD), r.text.slice(0, 200));
    r = await post('/api/productions', O, { title: 'Again, in capitals', kind: 'short', project: { type: 'pitch', id: PITCH.toUpperCase() } });
    ok('the pitch id in capitals: 409 naming the production it has', r.status === 409 && r.json && r.json.productionId === PROD, r.text.slice(0, 200));
    r = await post('/api/productions', O, { title: 'Again, no dashes', kind: 'short', project: { type: 'pitch', id: PITCH.replace(/-/g, '') } });
    ok('…without its dashes: 409 too', r.status === 409, r.text.slice(0, 200));
    r = await post(`/api/productions/${PROD}`, O, { title: `Review ${RUN}`, kind: 'short', project: { type: 'pitch', id: PITCH.toUpperCase() } }, 'PATCH');
    const stored = rows(`select project_id from public.productions where id = ${q(PROD)}`)[0];
    ok('an edit naming it in capitals saves the pitch’s own id', r.status === 200 && stored && stored.project_id === PITCH, [r.status, stored]);
    ok('…one live production for the pitch', rows(`select id from public.productions where project_type = 'pitch' and lower(project_id) = ${q(PITCH)} and status <> 'removed'`).length === 1);

    section('The dashboard tells outsiders what the production page does');
    r = await post(`/api/productions/${PROD}/members`, O, { userId: P.id, role: 'Producer' });
    ok('the owner lists a producer', r.status === 200 || r.status === 201, r.text.slice(0, 160));
    r = await post(`/api/productions/${PROD}/members`, O, { userId: C.id, role: 'Grip' });
    ok('…and a grip', r.status === 200 || r.status === 201, r.text.slice(0, 160));
    r = await call(`/api/productions/${PROD}/dashboard`, { who: SIGNED_OUT });
    ok('signed out: 401', r.status === 401, r.status);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: X });
    ok('a stranger on a public production: 403 not-manager (the page sends them to it)', r.status === 403 && r.json && r.json.code === 'not-manager', r.text.slice(0, 160));
    sql(`update public.productions set visibility = 'crew' where id = ${q(PROD)}`);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: X });
    ok('crew-only, a stranger: 404', r.status === 404, r.status);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: C });
    ok('crew-only, its grip: 403 not-manager', r.status === 403 && r.json && r.json.code === 'not-manager', r.status);
    sql(`update public.productions set visibility = 'private' where id = ${q(PROD)}`);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: C });
    ok('private, its grip: 404', r.status === 404, r.status);
    r = await call('/api/productions/mine', { who: C });
    const crewOn = (r.json && r.json.crewOn) || [];
    const items = (r.json && r.json.items) || [];
    ok('Your productions: a private one isn’t listed for plain crew', r.status === 200 && !crewOn.some((p) => p.id === PROD) && !items.some((i) => (i.id || (i.production && i.production.id)) === PROD), r.text.slice(0, 200));
    r = await call('/api/productions/mine', { who: P });
    ok('…its producer still has it', r.status === 200 && JSON.stringify(r.json).includes(PROD), r.status);
    sql(`update public.productions set visibility = 'public', moderation_hold = true where id = ${q(PROD)}`);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: X });
    ok('held, a stranger: 404 (nothing about a hold)', r.status === 404 && !/hold/i.test(r.text), r.text.slice(0, 160));
    r = await call(`/api/productions/${PROD}/dashboard`, { who: P });
    ok('held, its producer: 403 with the hold line', r.status === 403 && /on hold/.test(r.json && r.json.error), r.text.slice(0, 160));

    section('A held production: its producer changes nothing, its owner still can');
    r = await post(`/api/productions/${PROD}`, P, { status: 'shooting' }, 'PATCH');
    ok('the producer changing its status: 403 with the hold line', r.status === 403 && /on hold/.test(r.json && r.json.error), r.text.slice(0, 160));
    r = await post(`/api/productions/${PROD}/members`, P, { userId: X.id, role: 'Gaffer' });
    ok('…adding crew: 403', r.status === 403, r.text.slice(0, 160));
    ok('…nobody was added', rows(`select id from public.production_members where production_id = ${q(PROD)} and user_id = ${q(X.id)}`).length === 0);
    r = await post(`/api/productions/${PROD}`, O, { status: 'shooting' }, 'PATCH');
    ok('the owner still can (200)', r.status === 200, r.text.slice(0, 160));
    r = await post('/api/crew/calls', O, { role: 'Gaffer', title: `Gaffer ${RUN}`, spots: 1, payType: 'paid', startsOn: pacific(20), endsOn: pacific(21), remote: true, production: PROD });
    call1 = r.json && (r.json.id || (r.json.call && r.json.call.id));
    ok('a new call naming the held production: refused', r.status === 403 && /on hold/.test(r.json && r.json.error), r.text.slice(0, 200));
    sql(`update public.productions set moderation_hold = false where id = ${q(PROD)}`);

    section('A producer can’t add someone who blocked them');
    insert('user_blocks', { blocker_id: T.id, blocked_id: P.id });
    r = await post(`/api/productions/${PROD}/members`, P, { userId: T.id, role: 'Gaffer' });
    ok('403 with the blocking line', r.status === 403 && /blocked/.test(r.json && r.json.error), r.text.slice(0, 160));
    ok('…not added, not told', rows(`select id from public.production_members where production_id = ${q(PROD)} and user_id = ${q(T.id)}`).length === 0 && rows(`select id from public.notifications where user_id = ${q(T.id)}`).length === 0);

    section('A full admin who doesn’t run it: no Post a call, no Find a place');
    r = await call(`/api/productions/${PROD}/dashboard`, { who: ADMIN });
    const view = r.status === 200 ? productionDashboard(r.json.facts) : null;
    const ids = view ? view.actions.map((a) => a.id) : [];
    ok('the admin opens it, with Add a day and Message but not call or place', view && !ids.includes('call') && !ids.includes('place') && ids.includes('day'), ids);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: O });
    const own = r.status === 200 ? productionDashboard(r.json.facts).actions.map((a) => a.id) : [];
    ok('…the owner still has both', own.includes('call') && own.includes('place'), own);

    section('A release that isn’t public is named only to the owner');
    sql(`update public.productions set release_type = 'episode', release_id = ${q(`not-public-${RUN}`)}, release_title = ${q(`Hidden cut ${RUN}`)} where id = ${q(PROD)}`);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: P });
    ok('the producer: no title, no link', r.status === 200 && !JSON.stringify(r.json).includes(`Hidden cut ${RUN}`), r.status);
    r = await call(`/api/productions/${PROD}/dashboard`, { who: O });
    ok('…the owner sees it', r.status === 200 && JSON.stringify(r.json).includes(`Hidden cut ${RUN}`), r.status);

    section('The ☰ menu’s account types for someone with no profile row');
    sql(`delete from public.user_profiles where user_id = ${q(N.id)}`);
    r = await call('/api/my-role', { who: N });
    ok('/api/my-role: types [] (ready to add one), not null', r.status === 200 && r.json && r.json.accountTypes && Array.isArray(r.json.accountTypes.types) && r.json.accountTypes.types.length === 0, r.json && r.json.accountTypes);
  } finally {
    const ids = people.map((p) => q(p.id)).join(', ');
    try {
      sql(`delete from public.user_blocks where blocker_id in (${ids}) or blocked_id in (${ids})`);
      if (call1) sql(`delete from public.crew_calls where id = ${q(call1)}`);
      sql(`delete from public.crew_calls where poster_id in (${ids})`);
      sql(`delete from public.productions where owner_id in (${ids})`);
      sql(`delete from public.notifications where user_id in (${ids})`);
      sql(`delete from public.pitch_updates where pitch_id = ${q(PITCH)}`);
      sql(`delete from public.pitches where id = ${q(PITCH)}`);
      sql(`update public.site_settings set elevator_pitch_enabled = ${was && (was.elevator_pitch_enabled === true || was.elevator_pitch_enabled === 't') ? 'true' : 'false'} where id = 1`);
    } catch (err) {
      console.log('cleanup:', err.message);
    }
    for (const p of people) await removeUser(p.id).catch(() => {});
  }
});
