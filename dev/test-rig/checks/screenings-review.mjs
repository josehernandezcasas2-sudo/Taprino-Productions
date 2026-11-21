#!/usr/bin/env node
// Private screening links: the fixes from the review of 2026-11-21, end to end.
//   a visit belongs to the browser or the account that opened it: the key
//   alone, from another browser or signed out, plays nothing;
//   the country is checked on every play and beat, not only at the open;
//   playing takes the one screen at once (before any beat);
//   tries while locked are written once, and the lock holds;
//   a 109 screener's owner who doesn't run the title can read and end it but
//   never give it a password or run it again;
//   the Distribution page shows someone who doesn't run a link its state and
//   counts, never its address, password or who it's for;
//   a vertical show gets no links;
//   an edit never revives a link whose end has passed.
//   node dev/test-rig/checks/screenings-review.mjs
import crypto from 'node:crypto';
import { BASE, RUN, ok, section, runCheck, call, sql, rows, q, insert, newUser, removeUser, uidFor, IDS, ago } from './lib.mjs';

const ORIGIN = { Origin: BASE };
const cf = (u) => `https://customer-test.cloudflarestream.com/${u}/manifest/video.m3u8`;
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const PASSWORD = 'harbor-violet-37';
const ID = { film: `ck-sr-film-${RUN}`, vshow: `ck-sr-vshow-${RUN}`, vep: `ck-sr-vep-${RUN}`, show: `ck-sr-show-${RUN}`, sep: `ck-sr-sep-${RUN}` };
const PRODUCTION = crypto.randomUUID();
const LEGACY = crypto.randomBytes(18).toString('base64url');
let ipN = 0;
const ip = () => `198.51.100.${(ipN += 1) % 250}`;
const ep = (id, extra = {}) => ({
  id, title: `Check sr ${RUN}`, description: 'A review check title.', tier: 'premium', genre: 'Drama', main_genre: 'Drama', content_type: 'movie',
  artist: 'Ola', runtime: '24:00', rating: 'TV-14', release_year: 2026, src: cf(uidFor(IDS.film)), video_type: 'html5', video_provider: 'cloudflare',
  ads_enabled: true, deletion_requested: false, moderation_hold: false, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(5), poster: null, thumbnail: null, ...extra
});
const guest = (cookie = null) => ({ cookie: `__clerk_db_jwt=dvb_rig_signed_out${cookie ? `; tapa_scr=${cookie}` : ''}` });
const withGuest = (who, cookie) => ({ ...who, cookie: `${who.cookie}${cookie ? `; tapa_scr=${cookie}` : ''}` });
const cookieOf = (r) => { const m = /tapa_scr=([A-Za-z0-9_-]+)/.exec(r.headers.get('set-cookie') || ''); return m ? m[1] : null; };
const geo = (country) => ({ 'x-vercel-ip-country': country, 'x-vercel-ip-city': 'Somewhere' });
const open = (token, { who = guest(), password = PASSWORD, from = ip(), country = 'US' } = {}) => call(`/api/screener/${token}/open`, { who, method: 'POST', body: { password }, headers: { ...ORIGIN, 'X-Forwarded-For': from, ...geo(country) } });
const play = (token, session, who, country = 'US') => call(`/api/screener/${token}/play`, { who, method: 'POST', body: { session }, headers: { ...ORIGIN, 'X-Forwarded-For': ip(), ...geo(country) } });
const beat = (token, session, who, country = 'US') => call(`/api/screener/${token}/beat`, { who, method: 'POST', body: { session, position: 10, duration: 600, playing: true }, headers: { ...ORIGIN, 'X-Forwarded-For': ip(), ...geo(country) } });
const make = (who, target, extra = {}) => call('/api/screenings', { who, method: 'POST', headers: ORIGIN, body: { target, label: `Check sr ${RUN}`, endsAt: inDays(7), password: PASSWORD, maxViews: 20, perPerson: 5, oneScreen: false, notify: 'never', ...extra } });

await runCheck('screenings-review', async () => {
  const O = await newUser('sro', { role: 'creator', displayName: `Ola Owner ${RUN}`, handle: `sro${RUN}` });
  const D = await newUser('srd', { role: 'creator', displayName: `Dev Uploader ${RUN}`, handle: `srd${RUN}` });
  const V = await newUser('srv', { displayName: `Vic Viewer ${RUN}`, handle: `srv${RUN}` });
  try {
    insert('episodes', ep(ID.film, { submitted_by: O.id }));
    insert('series', { id: ID.show, name: `Check sr show ${RUN}`, description: 'x', creator_id: O.id, status: 'approved', kind: 'series', defaults: {}, seasons: [], credits: {}, deletion_requested: false, moderation_hold: false, created_at: ago(10) });
    insert('episodes', ep(ID.sep, { submitted_by: D.id, content_type: 'series', series_id: ID.show, season: 1, series_order: 1 }));
    insert('series', { id: ID.vshow, name: `Check sr vertical ${RUN}`, description: 'x', creator_id: O.id, status: 'approved', kind: 'vertical', defaults: {}, seasons: [], credits: {}, deletion_requested: false, moderation_hold: false, created_at: ago(10) });
    insert('episodes', ep(ID.vep, { submitted_by: O.id, content_type: 'vertical', series_id: ID.vshow, season: 1, series_order: 1 }));

    section('A visit belongs to the browser or account that opened it');
    let r = await make(O, { type: 'episode', id: ID.film });
    const A = r.json && r.json.link;
    ok('a link to the film', r.status === 201 && A, r.text.slice(0, 160));
    r = await open(A.token);
    const g1 = cookieOf(r);
    const s1 = r.json && r.json.session;
    ok('a guest opens it (a visit and a cookie)', r.status === 200 && s1 && g1, r.text.slice(0, 160));
    r = await play(A.token, s1, guest());
    ok('the key with no cookie: 401 session', r.status === 401 && r.json.reason === 'session', r.text.slice(0, 120));
    r = await play(A.token, s1, guest(crypto.randomBytes(18).toString('base64url')));
    ok('the key from another browser: 401 session', r.status === 401 && r.json.reason === 'session', r.status);
    r = await beat(A.token, s1, guest());
    ok('…its beat stops too', r.json && r.json.stop === true && r.json.reason === 'session', r.text.slice(0, 120));
    r = await play(A.token, s1, guest(g1));
    ok('the same browser: 200', r.status === 200 && r.json.current, r.status);
    r = await open(A.token, { who: withGuest(V, null) });
    const sv = r.json && r.json.session;
    const gv = cookieOf(r);
    ok('a signed-in viewer opens it', r.status === 200 && sv, r.status);
    r = await play(A.token, sv, guest(gv));
    ok('their key signed out (same browser): 401 session', r.status === 401 && r.json.reason === 'session', r.status);
    r = await play(A.token, sv, withGuest(D, gv));
    ok('their key under another account: 401 session', r.status === 401 && r.json.reason === 'session', r.status);
    r = await play(A.token, sv, withGuest(V, gv));
    ok('their own account: 200', r.status === 200, r.status);

    section('The country holds on every play and beat');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `US only ${RUN}`, countries: ['US'] });
    const U = r.json && r.json.link;
    r = await open(U.token);
    const gu = cookieOf(r);
    const su = r.json && r.json.session;
    ok('opened in the United States', r.status === 200 && su, r.status);
    r = await play(U.token, su, guest(gu), 'CA');
    ok('a play from Canada: 403 country', r.status === 403 && r.json.reason === 'country', r.text.slice(0, 120));
    r = await beat(U.token, su, guest(gu), 'CA');
    ok('a beat from Canada: stop country', r.json && r.json.stop === true && r.json.reason === 'country', r.text.slice(0, 120));
    r = await play(U.token, su, guest(gu), 'US');
    ok('back in the United States: 200', r.status === 200, r.status);

    section('Playing takes the one screen at once');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `One screen ${RUN}`, oneScreen: true });
    const S = r.json && r.json.link;
    r = await open(S.token);
    const gs = cookieOf(r);
    const ss = r.json && r.json.session;
    r = await play(S.token, ss, guest(gs));
    ok('the first screen plays', r.status === 200, r.status);
    r = await open(S.token);
    ok('a second screen, before any beat: 409 screen', r.status === 409 && r.json.reason === 'screen', r.text.slice(0, 120));

    section('Tries while locked are written once, and the lock holds');
    r = await make(O, { type: 'episode', id: ID.film }, { label: `Lock ${RUN}` });
    const L = r.json && r.json.link;
    const from = '203.0.113.231';
    let last = null;
    for (let i = 0; i < 5; i += 1) last = await open(L.token, { password: 'wrong-guess-00', from });
    ok('the fifth wrong password locks it there', last.status === 429 && last.json.reason === 'locked', last.text.slice(0, 120));
    for (let i = 0; i < 8; i += 1) last = await open(L.token, { password: 'wrong-guess-00', from });
    ok('…still locked after eight more', last.status === 429 && last.json.reason === 'locked', last.status);
    last = await open(L.token, { password: PASSWORD, from });
    ok('…even with the right password, from there', last.status === 429, last.status);
    const lockedRows = rows(`select count(*)::int as n from public.screener_refusals where screener_id = ${q(L.id)} and reason = 'locked'`)[0].n;
    ok('one “locked” row for the hour, not one a try', lockedRows === 1, lockedRows);
    const pwRows = rows(`select count(*)::int as n from public.screener_refusals where screener_id = ${q(L.id)} and reason = 'password'`)[0].n;
    ok('five wrong passwords on record', pwRows === 5, pwRows);
    last = await open(L.token, { password: PASSWORD });
    ok('the right password from elsewhere opens it', last.status === 200, last.status);

    section('A 109 screener’s owner who doesn’t run the title');
    insert('productions', { id: PRODUCTION, owner_id: D.id, title: `Check sr production ${RUN}`, status: 'post', release_type: 'episode', release_id: ID.film, release_title: 'Film' });
    insert('screeners', { production_id: PRODUCTION, episode_id: ID.sep, token: LEGACY, label: `Old ${RUN}`, expires_at: inDays(3), max_views: 5, created_by: D.id, created_at: ago(1), owner_id: D.id, target_type: 'episode', target_id: ID.sep, starts_at: ago(1) });
    const legacyId = rows(`select id from public.screeners where token = ${q(LEGACY)}`)[0].id;
    r = await call(`/api/screenings/${legacyId}`, { who: D });
    ok('they can read it', r.status === 200, r.status);
    r = await call(`/api/screenings/${legacyId}`, { who: D, method: 'PATCH', headers: ORIGIN, body: { action: 'password', password: 'sneaky-pass-11' } });
    ok('…but not give it a password (403)', r.status === 403, r.text.slice(0, 120));
    r = await call(`/api/screenings/${legacyId}`, { who: D, method: 'PATCH', headers: ORIGIN, body: { action: 'update', password: 'sneaky-pass-11' } });
    ok('…not through Edit settings either (403)', r.status === 403, r.status);
    ok('…it still has no password', rows(`select password_hash from public.screeners where id = ${q(legacyId)}`)[0].password_hash === null);
    r = await call(`/api/screenings/${legacyId}`, { who: D, method: 'PATCH', headers: ORIGIN, body: { action: 'end' } });
    ok('they can end it', r.status === 200, r.status);
    r = await call(`/api/screenings/${legacyId}/again`, { who: D, method: 'POST', headers: ORIGIN, body: {} });
    ok('…but not run it again (403)', r.status === 403, r.text.slice(0, 120));
    ok('…no new link made', rows(`select id from public.screeners where run_from = ${q(legacyId)}`).length === 0);
    r = await call(`/api/screenings/${legacyId}/again`, { who: O, method: 'POST', headers: ORIGIN, body: {} });
    ok('the show’s owner can run it again', r.status === 201, r.text.slice(0, 120));

    section('The Distribution page, for someone who doesn’t run the links');
    r = await call(`/api/productions/${PRODUCTION}/distribution`, { who: D });
    const s = r.json && r.json.screenings;
    const film = s && s.links.find((l) => l.id === A.id);
    ok('Dee sees Ola’s film link listed', r.status === 200 && film, r.text.slice(0, 160));
    ok('…with no address, code, password or names', film && film.token === null && film.url === null && film.path === null && film.code === null && film.password === null && film.recipientEmail === null && film.named.people.length === 0);
    ok('…and its state and counts', film && film.views >= 1 && film.stats && typeof film.stats.people === 'number');
    ok('…and canManage false', s && s.canManage === false);
    ok('older apps still get screeners: [] and episodes: []', Array.isArray(r.json.screeners) && Array.isArray(r.json.episodes));

    section('A vertical show gets no links');
    r = await make(O, { type: 'series', id: ID.vshow });
    ok('409 for a vertical show', r.status === 409, r.text.slice(0, 120));
    r = await make(O, { type: 'episode', id: ID.vep });
    ok('409 for a vertical title', r.status === 409, r.status);

    section('An edit never revives a link whose end has passed');
    sql(`update public.screeners set starts_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where id = ${q(A.id)}`);
    r = await call(`/api/screenings/${A.id}`, { who: O, method: 'PATCH', headers: ORIGIN, body: { action: 'update', endsAt: inDays(5) } });
    ok('409 ended', r.status === 409 && r.json.code === 'ended', r.status);
    ok('…its end stays in the past', Date.parse(rows(`select expires_at from public.screeners where id = ${q(A.id)}`)[0].expires_at) < Date.now());
  } finally {
    try {
      sql(`delete from public.screeners where owner_id in (${q(O.id)}, ${q(D.id)})`);
      sql(`delete from public.productions where id = ${q(PRODUCTION)}`);
      sql(`delete from public.episodes where id in (${Object.values(ID).map(q).join(', ')})`);
      sql(`delete from public.series where id in (${q(ID.show)}, ${q(ID.vshow)})`);
      sql(`delete from public.notifications where user_id in (${q(O.id)}, ${q(D.id)}, ${q(V.id)})`);
    } catch (err) {
      console.log('cleanup:', err.message);
    }
    for (const p of [O, D, V]) await removeUser(p.id).catch(() => {});
  }
});
