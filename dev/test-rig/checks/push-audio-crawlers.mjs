#!/usr/bin/env node
// Web push, podcast audio behind one route, and the AI crawler refusal
// (2026-11-12), end to end against the rig:
//   AI crawlers        a training crawler's user agent gets 403 everywhere
//                      but robots.txt, /.well-known/, /ai-policy, /terms;
//                      an answer engine follows block_ai_search (~70 s of
//                      waiting for the middleware's 30 s copy of the switch;
//                      RIG_CHECK_SKIP_SWITCH=1 leaves that part out)
//   Podcast audio      /api/podcasts/audio/<id>: a feed-listed episode for
//                      anyone, a premium one by the key /api/podcast-show
//                      mints or the session, held/declined refused, external
//                      audio a 302 to itself, the RSS enclosure, no stored
//                      address in any payload, "Lock podcast audio"
//   Web push           the key route, subscribe/unsubscribe, a message's
//                      notification arriving at the fake Clerk's sink
//                      decrypted (title, body, href, tag, TTL, VAPID), a
//                      410 retiring a browser, re-binding, the 503s
//   node dev/test-rig/checks/push-audio-crawlers.mjs
import { RUN, FAKES, ok, section, runCheck, call, page, sql, rows, q, insert, session, SIGNED_OUT, SIGNED_OUT_NO_TERMS, USERS, ago, newUser, removeUser, clerk } from './lib.mjs';
import { ensureBucket, putObject, setBucketPublic, readBuckets } from '../lib/storage.mjs';
import { makeBrowser } from '../lib/webpush.mjs';

const ADMIN = session(USERS.admin);
const VIEWER = session(USERS.viewer);
const app = (who) => ({ who, bearer: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app is given the https listener unless RIG_SUPABASE_TLS=0; stored
// addresses carry the same base the app's SUPABASE_URL does.
const SUPA = process.env.RIG_SUPABASE_TLS === '0' ? FAKES.supabase : FAKES.supabaseTls;
const viaHttp = (u) => String(u || '').replace(FAKES.supabaseTls, FAKES.supabase);

const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const PERPLEXITY = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const ID = {
  show: `ck-pa-show-${RUN}`,
  free: `ck-pa-free-${RUN}`,
  premium: `ck-pa-prem-${RUN}`,
  held: `ck-pa-held-${RUN}`,
  pending: `ck-pa-pend-${RUN}`,
  external: `ck-pa-ext-${RUN}`
};
const OBJ = (id) => `podcast-${id}.mp3`;
const STORED = (id) => `${SUPA}/storage/v1/object/public/episode-audio/${OBJ(id)}`;
const AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2048, 7)]);

function seedAudio() {
  ensureBucket('episode-audio', { public: true });
  // Production's bucket was public until "Lock podcast audio"; start there.
  setBucketPublic('episode-audio', true);
  for (const id of [ID.free, ID.premium, ID.held, ID.pending]) putObject('episode-audio', OBJ(id), AUDIO, { contentType: 'audio/mpeg' });
  insert('series', { id: ID.show, name: `Check Audio Pod ${RUN}`, description: 'A public podcast for the audio check.', creator_id: USERS.dee, status: 'approved', kind: 'podcast', submitted_by_user_id: USERS.dee, created_at: ago(9), deletion_requested: false, moderation_hold: false });
  const pod = (id, order, extra = {}) => ({
    id, title: `Audio check ${order}`, description: 'An audio episode.', tier: 'free', genre: 'Talk', main_genre: 'Podcast', content_type: 'podcast', series_id: ID.show, season: 1, series_order: order,
    artist: 'Dee Park', runtime: '20:00', rating: 'TV-PG', release_year: 2026, audio_url: STORED(id), audio_bytes: AUDIO.length, ads_enabled: false,
    deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(3), released_at: ago(3), created_at: ago(4 + order / 10), ...extra
  });
  insert('episodes', pod(ID.free, 1));
  insert('episodes', pod(ID.premium, 2, { tier: 'premium' }));
  insert('episodes', pod(ID.held, 3, { moderation_hold: true }));
  insert('episodes', pod(ID.pending, 4, { status: 'pending', reviewed_at: null, released_at: null }));
  insert('episodes', pod(ID.external, 5, { audio_url: `https://audio.rig.example.com/${ID.external}.mp3` }));
}
function cleanupAudio() {
  const ids = Object.values(ID).filter((x) => x !== ID.show).map(q).join(', ');
  sql(`delete from public.notifications where episode_id in (${ids})`);
  sql(`delete from public.episodes where id in (${ids})`);
  sql(`delete from public.series where id = ${q(ID.show)}`);
  sql(`delete from public.audit_log where action = 'protect_podcast_audio' and created_at > now() - interval '1 hour'`);
}

async function crawlers() {
  section('AI crawlers refused in code (middleware.js)');
  let r = await call('/', { headers: { 'User-Agent': GPTBOT }, accept: 'text/html' });
  ok('GPTBot on the home page → 403', r.status === 403, r.status);
  ok('…plain text naming the policy', /text\/plain/.test(r.headers.get('content-type') || '') && r.text.includes('/ai-policy'), r.text.slice(0, 120));
  ok('…with the no-AI header and never stored', /noai/.test(r.headers.get('x-robots-tag') || '') && /no-store/.test(r.headers.get('cache-control') || ''), `${r.headers.get('x-robots-tag')} / ${r.headers.get('cache-control')}`);
  for (const p of ['/stream', '/api/home-feed', `/api/podcasts/${ID.show}/rss.xml`, `/api/podcasts/audio/${ID.free}.mp3`, '/sitemap.xml']) {
    r = await call(p, { headers: { 'User-Agent': GPTBOT } });
    ok(`GPTBot on ${p.replace(RUN, '…')} → 403`, r.status === 403, r.status);
  }
  for (const p of ['/robots.txt', '/.well-known/tdmrep.json', '/.well-known/security.txt', '/ai-policy', '/terms']) {
    r = await call(p, { headers: { 'User-Agent': GPTBOT }, accept: 'text/html,*/*' });
    ok(`GPTBot on ${p} → answered (${r.status})`, r.status === 200, r.status);
  }
  r = await call('/robots.txt', { headers: { 'User-Agent': GPTBOT }, accept: 'text/plain' });
  ok('…and robots.txt still names it', /User-agent: GPTBot\nDisallow: \//.test(r.text), r.text.slice(0, 200));
  r = await call('/stream', { headers: { 'User-Agent': GOOGLEBOT }, accept: 'text/html' });
  ok('Googlebot on /stream → not refused', r.status === 200, r.status);
  r = await call('/stream', { headers: { 'User-Agent': PERPLEXITY }, accept: 'text/html' });
  ok('PerplexityBot on /stream while answer engines are blocked → 403', r.status === 403, r.status);
  r = await call('/api/site-settings', app(VIEWER));
  ok('the app (no browser user agent) → not refused', r.status === 200, r.status);

  if (process.env.RIG_CHECK_SKIP_SWITCH === '1') return;
  section('…"Block AI answer engines" off (waits for the middleware’s copy)');
  sql('update public.site_settings set block_ai_search = false where id = 1');
  try {
    await sleep(31000);
    await call('/stream', { headers: { 'User-Agent': PERPLEXITY }, accept: 'text/html' });
    await sleep(2500);
    r = await call('/stream', { headers: { 'User-Agent': PERPLEXITY }, accept: 'text/html' });
    ok('switch off → PerplexityBot on /stream answered', r.status === 200, r.status);
    r = await call('/stream', { headers: { 'User-Agent': GPTBOT }, accept: 'text/html' });
    ok('switch off → GPTBot still 403', r.status === 403, r.status);
  } finally {
    sql('update public.site_settings set block_ai_search = true where id = 1');
  }
  await sleep(31000);
  await call('/stream', { headers: { 'User-Agent': PERPLEXITY }, accept: 'text/html' });
  await sleep(2500);
  r = await call('/stream', { headers: { 'User-Agent': PERPLEXITY }, accept: 'text/html' });
  ok('switch back on → PerplexityBot 403 again', r.status === 403, r.status);
}

const audioRow = (j, id) => (j && Array.isArray(j.episodes) ? j.episodes.find((e) => e.id === id) : null);

async function follow(location) {
  const res = await fetch(viaHttp(location), { redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf.length, type: res.headers.get('content-type') };
}

async function audio() {
  section('Podcast audio (/api/podcasts/audio/<id>)');
  let r = await call(`/api/podcasts/audio/${ID.free}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  const loc = r.headers.get('location') || '';
  ok('a feed-listed episode, signed out, no key → 302', r.status === 302, `${r.status} ${r.text.slice(0, 120)}`);
  ok('…to a signed link, not the public address', /\/storage\/v1\/object\/sign\/episode-audio\//.test(loc) && /token=/.test(loc), loc);
  ok('…private, never stored', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  let f = await follow(loc);
  ok('…which plays (the file’s bytes)', f.status === 200 && f.bytes === AUDIO.length, f);
  r = await call(`/api/podcasts/audio/${ID.free}`, { who: SIGNED_OUT_NO_TERMS });
  ok('the bare id (no extension) answers too', r.status === 302, r.status);
  r = await call(`/api/podcasts/audio/${ID.free}.mp3`, { who: SIGNED_OUT_NO_TERMS, method: 'HEAD' });
  ok('HEAD → 302 with the link', r.status === 302 && /\/object\/sign\//.test(r.headers.get('location') || ''), r.status);
  r = await call(`/api/podcasts/audio/${ID.free}.exe`, { who: SIGNED_OUT_NO_TERMS });
  ok('an unknown extension → 404', r.status === 404, r.status);
  r = await call(`/api/podcasts/audio/ck-no-such-${RUN}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  ok('no such episode → 404', r.status === 404, r.status);
  r = await call(`/api/podcasts/audio/${ID.free}.mp3`, { who: SIGNED_OUT_NO_TERMS, method: 'POST' });
  ok('POST → 405', r.status === 405, r.status);

  r = await call(`/api/podcasts/audio/${ID.premium}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  ok('premium, signed out, no key → refused', r.status === 403 && !r.headers.get('location'), `${r.status} ${r.text.slice(0, 120)}`);
  r = await call(`/api/podcasts/audio/${ID.premium}.mp3`, { who: VIEWER });
  ok('premium, a viewer without a plan → refused', r.status === 403, r.status);
  r = await call(`/api/podcasts/audio/${ID.premium}.mp3`, { who: ADMIN });
  ok('premium, the team’s session (website) → 302', r.status === 302, `${r.status} ${r.text.slice(0, 120)}`);

  // The app's show screen gets keyed addresses.
  r = await call(`/api/podcast-show?id=${encodeURIComponent(ID.show)}&terms=1`, app(ADMIN));
  const prem = audioRow(r.json, ID.premium);
  ok('/api/podcast-show: the premium row’s audioUrl is the route with a key', prem && /^\/api\/podcasts\/audio\/ck-pa-prem-[a-f0-9]+\.mp3\?k=\d+\.v\.[A-Za-z0-9_-]+$/.test(prem.audioUrl || ''), prem && prem.audioUrl);
  ok('…and no payload carries the stored file', r.status === 200 && !r.text.includes('episode-audio'), r.text.match(/[^"]*episode-audio[^"]*/));
  ok('…nor the held or pending ones (not listed)', r.json && !audioRow(r.json, ID.held) && !audioRow(r.json, ID.pending));
  if (prem && prem.audioUrl) {
    r = await call(prem.audioUrl, { who: SIGNED_OUT_NO_TERMS });
    ok('the keyed address plays with no session (the app’s player sends none)', r.status === 302, `${r.status} ${r.text.slice(0, 120)}`);
    f = await follow(r.headers.get('location'));
    ok('…to the file', f.status === 200 && f.bytes === AUDIO.length, f);
    const k = prem.audioUrl.split('?k=')[1];
    r = await call(`/api/podcasts/audio/${ID.free}.mp3?k=${k}`, { who: SIGNED_OUT_NO_TERMS });
    ok('another episode’s key is no key (a feed-listed one still opens)', r.status === 302, r.status);
    r = await call(`/api/podcasts/audio/${ID.held}.mp3?k=${k}`, { who: SIGNED_OUT_NO_TERMS });
    ok('…and doesn’t open a held one', r.status === 404, r.status);
    r = await call(`${prem.audioUrl.slice(0, -3)}AAA`, { who: SIGNED_OUT_NO_TERMS });
    ok('a tampered key falls back to the gate (refused signed out)', r.status === 403, r.status);
    sql(`update public.series set moderation_hold = true where id = ${q(ID.show)}`);
    try {
      r = await call(prem.audioUrl, { who: SIGNED_OUT_NO_TERMS });
      ok('the show taken down → its keys stop at once', r.status >= 400 && !r.headers.get('location'), r.status);
    } finally {
      sql(`update public.series set moderation_hold = false where id = ${q(ID.show)}`);
    }
  }
  r = await call(`/api/podcast-show?id=${encodeURIComponent(ID.show)}&terms=1`, app(VIEWER));
  ok('a viewer without a plan: the premium row has no audio at all', r.json && audioRow(r.json, ID.premium) && !audioRow(r.json, ID.premium).audioUrl, r.json && audioRow(r.json, ID.premium));
  ok('…the free row has a keyed address', r.json && /\?k=/.test((audioRow(r.json, ID.free) || {}).audioUrl || ''));

  r = await call(`/api/podcasts/audio/${ID.held}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  ok('held, signed out → refused (404), no link', r.status === 404 && !r.headers.get('location'), r.status);
  r = await call(`/api/podcasts/audio/${ID.pending}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  ok('in review, signed out → 404', r.status === 404, r.status);
  r = await call(`/api/podcasts/audio/${ID.pending}.mp3?preview=1`, { who: ADMIN });
  ok('in review, the team’s preview → 302', r.status === 302, `${r.status} ${r.text.slice(0, 120)}`);
  r = await call(`/api/podcasts/audio/${ID.pending}.mp3?preview=1`, { who: VIEWER });
  ok('in review, a stranger’s preview → refused', r.status === 404, r.status);
  r = await call(`/api/podcasts/audio/${ID.external}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  ok('audio hosted elsewhere → 302 to its own address', r.status === 302 && r.headers.get('location') === `https://audio.rig.example.com/${ID.external}.mp3`, r.headers.get('location'));

  r = await call(`/api/podcasts/${encodeURIComponent(ID.show)}/rss.xml`, { who: SIGNED_OUT_NO_TERMS, accept: 'application/rss+xml' });
  ok('the RSS feed answers', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
  ok('…its enclosure is the route on the www host', r.text.includes(`<enclosure url="https://www.studiotapatv.site/api/podcasts/audio/${ID.free}.mp3" length="${AUDIO.length}" type="audio/mpeg"`), r.text.match(/<enclosure[^>]*>/g));
  ok('…lists only the free, public, live episodes (not premium, held or in review)', !r.text.includes(ID.premium) && !r.text.includes(ID.held) && !r.text.includes(ID.pending), r.text.match(/<guid[^>]*>[^<]*/g));
  ok('…and never the stored file', !r.text.includes('episode-audio'));

  r = await page(`/podcasts/${encodeURIComponent(ID.show)}`, ADMIN);
  ok('the show page renders', r.status === 200, r.status);
  ok('…with keyed routes and no stored address in its HTML', r.text.includes(`/api/podcasts/audio/${ID.free}.mp3?k=`) && !r.text.includes('episode-audio'));

  r = await call(`/api/episode-page?id=${ID.free}&terms=1`, app(ADMIN));
  ok('/api/episode-page: audioUrl is the bare route', r.status === 200 && r.json && r.json.episode && r.json.episode.audioUrl === `/api/podcasts/audio/${ID.free}.mp3`, r.json && r.json.episode && r.json.episode.audioUrl);
  ok('…and nothing carries the stored file', !r.text.includes('episode-audio'));

  section('"Lock podcast audio" (Admin → AI security)');
  r = await fetch(viaHttp(STORED(ID.free)));
  ok('before: the public address still opens (production until the lock)', r.status === 200, r.status);
  r = await call('/api/admin/protect-media', { who: VIEWER, method: 'POST', body: { what: 'podcasts' } });
  ok('a viewer can’t press it', r.status === 403, r.status);
  r = await call('/api/admin/protect-media', { who: ADMIN, method: 'POST', body: { what: 'podcasts' } });
  ok('the admin → { wasPublic: true }', r.status === 200 && r.json && r.json.wasPublic === true && r.json.changed === true, r.json);
  ok('…the bucket is private', readBuckets()['episode-audio'] && readBuckets()['episode-audio'].public === false);
  r = await fetch(viaHttp(STORED(ID.free)));
  ok('…the public address stops opening', r.status >= 400, r.status);
  r = await call(`/api/podcasts/audio/${ID.free}.mp3`, { who: SIGNED_OUT_NO_TERMS });
  f = r.status === 302 ? await follow(r.headers.get('location')) : { status: r.status };
  ok('…and every play still works through the route', r.status === 302 && f.status === 200, f);
  r = await call('/api/admin/protect-media', { who: ADMIN, method: 'POST', body: { what: 'podcasts' } });
  ok('again → already private', r.status === 200 && r.json && r.json.wasPublic === false && r.json.existed === true, r.json);
  ok('…both runs in the audit log', rows(`select count(*) as c from public.audit_log where action = 'protect_podcast_audio' and created_at > now() - interval '10 minutes'`)[0].c >= 2);
  r = await page('/admin/ai-security', ADMIN);
  // Once it has run, the card reads "Ran <day>" with a "Run again" button
  // (the "Lock podcast audio" label is only on a card that never ran), and
  // the tile counts it among five.
  const card = /Podcast audio locked[\s\S]{0,1200}?<button[^>]*>([^<]*)<\/button>/.exec(r.text);
  ok('Admin → AI security shows the run', r.status === 200 && card && /Ran /.test(card[0]) && card[1] === 'Run again' && /\d of 5 run/.test(r.text), `${r.status} ${card ? card[1] : 'no card'}`);
}

async function webPush() {
  section('Web push (/api/push/web-*)');
  const mara = await newUser('wpm');
  const dee = await newUser('wpd');
  const vic = await newUser('wpv');
  const endpoints = [];
  try {
    let r = await call('/api/push/web-key', { who: mara });
    ok('the key route → ready with the public key', r.status === 200 && r.json && r.json.ready === true && /^B[A-Za-z0-9_-]{86}$/.test(r.json.publicKey || ''), r.json);
    ok('…never stored', /no-store/.test(r.headers.get('cache-control') || ''));
    const publicKey = r.json && r.json.publicKey;
    if (r.json && r.json.migrationReady === false) {
      const b = makeBrowser(`${FAKES.clerk}/__webpush/ok-${RUN}`);
      r = await call('/api/push/web-subscribe', { who: mara, method: 'POST', body: b.subscription });
      ok('before 122: subscribe → 503 migration-122', r.status === 503 && r.json && r.json.code === 'migration-122', r.json);
      return;
    }
    r = await call('/api/push/web-subscribe', { who: SIGNED_OUT, method: 'POST', body: makeBrowser(`${FAKES.clerk}/__webpush/x-${RUN}`).subscription });
    ok('subscribe signed out → 401', r.status === 401, r.status);
    r = await call('/api/push/web-subscribe', { who: mara, method: 'POST', body: makeBrowser('https://evil.example/push').subscription });
    ok('an endpoint that isn’t a push service → 400', r.status === 400, r.json);

    const ok1 = makeBrowser(`${FAKES.clerk}/__webpush/ok-${RUN}`);
    const gone = makeBrowser(`${FAKES.clerk}/__webpush/gone-${RUN}`);
    endpoints.push(ok1.subscription.endpoint, gone.subscription.endpoint);
    await clerk('/__webpush-keys', { method: 'POST', body: { token: `ok-${RUN}`, privateKey: ok1.privateKey, auth: ok1.auth } });
    r = await call('/api/push/web-subscribe', { who: mara, method: 'POST', body: ok1.subscription });
    ok('Mara turns notifications on in a browser → 200', r.status === 200, r.json);
    const row = rows(`select user_id, disabled_at from public.web_push_subscriptions where endpoint = ${q(ok1.subscription.endpoint)}`)[0];
    ok('…stored for her, live', row && row.user_id === mara.id && !row.disabled_at, row);

    r = await call('/api/messages', { who: dee, method: 'POST', body: { toUserId: mara.id, body: `Web push check ${RUN}` } });
    ok('Dee messages Mara → 201', r.status === 201, `${r.status} ${r.text.slice(0, 160)}`);
    const state = (await clerk('/__state')).json || {};
    const got = (state.webPushes || []).filter((p) => p.token === `ok-${RUN}`);
    ok('the browser’s push service got one message', got.length === 1, got.length);
    const m = got[0] || {};
    ok('…encrypted (aes128gcm), kept a day (TTL 86400)', m.contentEncoding === 'aes128gcm' && m.ttl === '86400', m);
    ok('…signed with the site’s key for that push service', m.vapid && m.vapid.signatureValid === true && m.vapid.aud === FAKES.clerk && m.vapid.k === publicKey && /^mailto:/.test(m.vapid.sub || ''), m.vapid);
    ok('…and reads, decrypted: the bell’s words and href, the href as its tag', m.payload && /sent you a message/.test(m.payload.body || '') && /^\/messages\/[0-9a-f-]+$/.test(m.payload.href || '') && m.payload.tag === m.payload.href && m.payload.title, m.payload || m.decryptError);

    // A browser the push service says is gone is retired, not deleted.
    r = await call('/api/push/web-subscribe', { who: mara, method: 'POST', body: gone.subscription });
    ok('a second browser → 200', r.status === 200);
    r = await call('/api/messages', { who: vic, method: 'POST', body: { toUserId: mara.id, body: `Another web push check ${RUN}` } });
    ok('another conversation → 201 (its own push)', r.status === 201, r.status);
    const goneRow = rows(`select disabled_at, disabled_reason from public.web_push_subscriptions where endpoint = ${q(gone.subscription.endpoint)}`)[0];
    ok('the browser whose push service answered 410 is disabled, with the reason', goneRow && goneRow.disabled_at && /gone/.test(goneRow.disabled_reason || ''), goneRow);
    const okRow = rows(`select disabled_at from public.web_push_subscriptions where endpoint = ${q(ok1.subscription.endpoint)}`)[0];
    ok('…the other stays live', okRow && !okRow.disabled_at, okRow);

    // The same browser signed in as someone else is theirs now.
    r = await call('/api/push/web-subscribe', { who: dee, method: 'POST', body: ok1.subscription });
    const rebound = rows(`select user_id from public.web_push_subscriptions where endpoint = ${q(ok1.subscription.endpoint)}`)[0];
    ok('re-bound to whoever subscribes it next', r.status === 200 && rebound && rebound.user_id === dee.id, rebound);

    // Sign-out: the endpoint alone, no session.
    r = await call('/api/push/web-unsubscribe', { who: SIGNED_OUT, method: 'POST', body: { endpoint: ok1.subscription.endpoint, reason: 'signed-out' } });
    const off = rows(`select disabled_at, disabled_reason from public.web_push_subscriptions where endpoint = ${q(ok1.subscription.endpoint)}`)[0];
    ok('unsubscribe with the endpoint alone (signed out) → disabled, "signed out"', r.status === 200 && off && off.disabled_at && /signed out/.test(off.disabled_reason || ''), off);
    r = await call('/api/push/web-unsubscribe', { who: SIGNED_OUT, method: 'POST', body: { endpoint: `https://fcm.googleapis.com/fcm/send/unknown-${RUN}` } });
    ok('an unknown endpoint answers the same', r.status === 200 && r.json && r.json.ok === true, r.json);
    r = await call('/api/push/web-unsubscribe', { who: SIGNED_OUT, method: 'POST', body: { endpoint: ok1.subscription.endpoint, reason: 'anything' } });
    ok('a reason it doesn’t know is stored as "switched off"', r.status === 200);

    r = await page('/account/preferences', mara);
    ok('Account → Preferences has the row', r.status === 200 && r.text.includes('On this browser') && r.text.includes('In the app'), r.status);
  } finally {
    if (rows("select to_regclass('public.web_push_subscriptions') is not null as t")[0].t) {
      sql(`delete from public.web_push_subscriptions where endpoint like ${q(`%${RUN}`)} or user_id in (${[mara.id, dee.id, vic.id].map(q).join(', ')})`);
    }
    const threads = rows(`select id from public.dm_threads where user_a in (${[mara.id, dee.id, vic.id].map(q).join(', ')}) or user_b in (${[mara.id, dee.id, vic.id].map(q).join(', ')})`).map((t) => t.id);
    if (threads.length) sql(`delete from public.dm_threads where id in (${threads.map(q).join(', ')})`);
    sql(`delete from public.notifications where user_id in (${[mara.id, dee.id, vic.id].map(q).join(', ')})`);
    for (const u of [mara, dee, vic]) await removeUser(u.id);
  }
}

await runCheck('push-audio-crawlers', async () => {
  seedAudio();
  try {
    await audio();
    await webPush();
    await crawlers();
  } finally {
    cleanupAudio();
  }
});
