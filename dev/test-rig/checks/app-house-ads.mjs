#!/usr/bin/env node
// House ads in the app (2026-11-12), called the way the app calls:
// Authorization: Bearer, no Origin, no cookie.
//   /api/episode-page   what the app reads to decide (lib/adBreakRules.js
//                       adsOnFor): adFree, isAdmin, purchase.owned,
//                       episode.adsEnabled / adBreakSeconds / adPlan — a
//                       viewer and a Standard member get ads, a Premium
//                       member, the team and a buyer none, a title with ads
//                       off none
//   /api/house-ads/pick  with ?episode=&surface= a signed impression that
//                       names the title (ad share); without, none; brand,
//                       length and the click tracker on the answer
//   /api/house-ads/impression  the pick's pixel records the title's
//                       ad_impression_days row; a replay, a forged title or
//                       surface, an unsigned pixel count nothing; the
//                       creator's own play counts for the advertiser only
//   /api/house-ads/click the count-only tracker
//   /api/ad-plan/fill   a ready plan's break, vod and live, its pixels
//                       signed for the title and surface
//   the swipe feeds     `adsOn` on /api/vertical-discover-feed and
//                       /api/snippets-feed; the reel pick signs no title
//   node dev/test-rig/checks/app-house-ads.mjs
import crypto from 'node:crypto';
import { IDS, USERS, RUN, ok, section, runCheck, call, sql, rows, q, insert, session, newUser, removeUser, stripeHook, stripeApi, forgetInvoiceEvents, ago, uidFor, browser, goto, SIGNED_OUT } from './lib.mjs';
import { adsOnFor, reelAdsOn, titleBreaks, titleSlot, preRollOf, liveSlot, reelSlot, adPickPath } from '../../../lib/adBreakRules.js';

const ADMIN = session(USERS.admin);
const DEE = session(USERS.dee);
const app = (who) => ({ who, bearer: true });
const src = (key) => `https://customer-test.cloudflarestream.com/${uidFor(key)}/manifest/video.m3u8`;
const ID = {
  film: `ck-ads-film-${RUN}`, // Dee's, ads on: a pre-roll and a break at 10:00
  off: `ck-ads-off-${RUN}`, // ads switched off
  plan: `ck-ads-plan-${RUN}` // a ready ad plan (on demand): breaks at 0:00 and 10:00
};
const AD = { house: null, advertiser: null, account: null };
const people = [];
const invoices = [];

const film = (id, extra = {}) => ({
  id, title: `Check ads ${id.slice(7, 11)} ${RUN}`, description: 'House ads in the app.', tier: 'free', genre: 'Drama', main_genre: 'Drama', content_type: 'movie', artist: 'Dee Park',
  runtime: '24:00', rating: 'TV-PG', release_year: 2026, src: src(IDS.short), video_type: 'html5', video_provider: 'cloudflare', ads_enabled: true, ad_break_seconds: [0, 600],
  deletion_requested: false, moderation_hold: false, submitted_by: USERS.dee, status: 'approved', reviewed_at: ago(4), released_at: ago(4), created_at: ago(5), ...extra
});

function seed() {
  insert('episodes', film(ID.film));
  insert('episodes', film(ID.off, { ads_enabled: false }));
  insert('episodes', film(ID.plan, { ad_break_seconds: [300] }));
  sql(`insert into public.episode_ad_plans (episode_id, status, breaks, round_to, on_demand, auto_bumper) values (${q(ID.plan)}, 'ready', ${q(JSON.stringify([{ at: 0, pieces: [{ kind: 'exact', seconds: 15 }] }, { at: 600, pieces: [{ kind: 'exact', seconds: 15 }] }]))}::jsonb, 15, true, 'hold')`);
  // A house ad (no advertiser account) that runs everywhere, and an
  // advertiser's, switched off until the brand check.
  AD.house = crypto.randomUUID();
  AD.account = crypto.randomUUID();
  AD.advertiser = crypto.randomUUID();
  sql(`insert into public.house_ads (id, title, advertiser, video_url, duration_seconds, click_url, weight, active, review_status, created_by) values (${q(AD.house)}, 'Check house ad ${RUN}', 'Kettle Coffee', 'https://ads.rig.example.com/kettle-${RUN}.mp4', 15, 'https://kettle.example.com/', 1, true, 'approved', ${q(USERS.admin)})`);
  sql(`insert into public.ad_accounts (id, user_id, company_name, contact_email, status, credit_balance_cents) values (${q(AD.account)}, ${q(USERS.viewer)}, 'Harbor Bikes ${RUN}', 'ads-${RUN}@rig.example.com', 'active', 5000)`);
  sql(`insert into public.house_ads (id, title, advertiser, video_url, duration_seconds, click_url, weight, active, review_status, ad_account_id, cost_per_impression_cents) values (${q(AD.advertiser)}, 'Check advertiser ad ${RUN}', 'Harbor', 'https://ads.rig.example.com/harbor-${RUN}.mp4', 15, 'https://harbor.example.com/', 1, false, 'approved', ${q(AD.account)}, 1)`);
}

async function cleanup() {
  const eps = Object.values(ID).map(q).join(', ');
  const ads = [AD.house, AD.advertiser].filter(Boolean).map(q).join(', ') || 'null';
  const ids = people.map(q).join(', ') || "''";
  await forgetInvoiceEvents({ members: people, invoices });
  const subs = (await stripeHook('/__state')).json.objects.filter((o) => o.object === 'subscription' && o.metadata && people.includes(o.metadata.member));
  for (const s of subs) await stripeApi(`/subscriptions/${s.id}`, { method: 'DELETE' });
  sql(`delete from public.ad_impression_days where ad_id in (${ads})`);
  sql(`delete from public.house_ads where id in (${ads})`);
  if (AD.account) sql(`delete from public.ad_accounts where id = ${q(AD.account)}`);
  sql(`delete from public.creator_ledger where member_id in (${ids})`);
  sql(`delete from public.member_referrals where user_id in (${ids})`);
  sql(`delete from public.member_payments where user_id in (${ids})`);
  sql(`delete from public.member_customers where user_id in (${ids})`);
  sql(`delete from public.member_lineups where user_id in (${ids})`);
  sql(`delete from public.purchases where buyer_id in (${ids})`);
  sql(`delete from public.notifications where user_id in (${ids}) or episode_id in (${eps})`);
  sql(`delete from public.episodes where id in (${eps})`);
  for (const id of people) await removeUser(id);
}

async function person(tag) {
  const m = await newUser(tag);
  people.push(m.id);
  return m;
}
// A member through the fake Stripe's Checkout, as the website subscribes.
async function subscribe(who, tier) {
  const r = await call('/api/create-checkout-session', { who, method: 'POST', body: { tier } });
  const sid = r.json && r.json.url ? r.json.url.split('/checkout/')[1] : null;
  if (!sid) return false;
  const done = await stripeHook(`/__checkout/${sid}/complete`, { method: 'POST' });
  const objs = (await stripeHook('/__state')).json.objects;
  for (const o of objs) if (o.object === 'invoice' && o.customer && done.json && done.json.session && o.customer === done.json.session.customer) invoices.push(o.id);
  return done.status === 200;
}

const page = (id, who) => call(`/api/episode-page?id=${encodeURIComponent(id)}&terms=1`, app(who));
// What the app's episode screen computes from the payload (mobile/src/app/episode/[id].js).
const appAdsOn = (j, { trailer = false } = {}) => adsOnFor({
  previewing: Boolean(j.preview && typeof j.preview === 'object'),
  trailer,
  adFree: Boolean(j.adFree),
  isAdmin: Boolean(j.isAdmin),
  owned: Boolean(j.purchase && j.purchase.owned),
  adsEnabled: j.episode ? j.episode.adsEnabled : false
});
const imp = (adId, episodeId) => rows(`select surface, sum(impressions)::int as n from public.ad_impression_days where ad_id = ${q(adId)} and episode_id = ${q(episodeId)} group by surface order by surface`);
const counter = (adId, col) => Number(rows(`select ${col} as n from public.house_ads where id = ${q(adId)}`)[0].n);
// The pixel and the click tracker allow one count per viewer per ad per ten
// minutes, keyed on the address (lib/rateLimit.js rateLimitKeyForRequest):
// every viewer here gets an address of its own, as phones would.
let ipSeq = 0;
const runByte = parseInt(RUN.slice(0, 2), 16);
const ipOf = new Map();
const ip = (who) => {
  const k = who.userId || 'signed-out';
  if (!ipOf.has(k)) { ipSeq += 1; ipOf.set(k, `10.${runByte}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`); }
  return ipOf.get(k);
};
const pixel = (url, who) => call(url.replace(/^https?:\/\/[^/]+/, ''), { ...app(who), accept: 'image/gif', headers: { 'X-Forwarded-For': ip(who) } });

async function whoGetsAds() {
  section('Who gets ads (the payload the app decides from)');
  const viewer = await person('adsview');
  let r = await page(ID.film, viewer);
  const e = r.json && r.json.episode;
  ok('a viewer: 200 with the episode', r.status === 200 && e && e.id === ID.film, `${r.status} ${r.text.slice(0, 200)}`);
  ok('…the payload carries adFree, isAdmin, purchase', r.json && r.json.adFree === false && r.json.isAdmin === false && r.json.purchase && r.json.purchase.owned === false, r.json && { adFree: r.json.adFree, isAdmin: r.json.isAdmin, purchase: r.json.purchase });
  ok('…and the title’s adsEnabled and break times', e && e.adsEnabled === true && JSON.stringify(e.adBreakSeconds) === '[0,600]' && e.adPlan === null, e && { adsEnabled: e.adsEnabled, adBreakSeconds: e.adBreakSeconds, adPlan: e.adPlan });
  ok('…no playable address in it', e && !e.src, e && e.src);
  ok('a viewer gets ads; a pre-roll and a break at 10:00', appAdsOn(r.json) && JSON.stringify(titleBreaks({ adsOn: true, adBreakSeconds: e.adBreakSeconds })) === JSON.stringify([{ at: 0, index: null }, { at: 600, index: null }]));
  ok('…none on the trailer', !appAdsOn(r.json, { trailer: true }));

  r = await page(ID.off, viewer);
  ok('a title with ads off: adsEnabled false → no ads', r.status === 200 && r.json.episode.adsEnabled === false && !appAdsOn(r.json), r.json && r.json.episode && r.json.episode.adsEnabled);

  r = await page(ID.film, ADMIN);
  ok('the team: isAdmin true → no ads', r.status === 200 && r.json.isAdmin === true && !appAdsOn(r.json), r.json && { isAdmin: r.json.isAdmin, adFree: r.json.adFree });

  const buyer = await person('adsbuy');
  insert('purchases', { buyer_id: buyer.id, target_type: 'episode', target_id: ID.film, creator_id: USERS.dee, title: 'Check', price_cents: 199, paid_cents: 199, creator_cents: 129, fee_cents: 36, platform_cents: 70, status: 'completed', completed_at: ago(1) });
  r = await page(ID.film, buyer);
  ok('a buyer: purchase.owned → no ads', r.status === 200 && r.json.purchase && r.json.purchase.owned === true && !appAdsOn(r.json), r.json && r.json.purchase);
  r = await page(ID.off, buyer);
  ok('…and the same buyer on another title: not owned (ads would follow the title)', r.status === 200 && r.json.purchase && r.json.purchase.owned === false);

  const standard = await person('adsstd');
  const premium = await person('adsprem');
  ok('a Standard member subscribes through Checkout', await subscribe(standard, 'standard'));
  ok('a Premium member subscribes through Checkout', await subscribe(premium, 'premium'));
  r = await page(ID.film, standard);
  ok('Standard: a member, not ad-free → ads', r.status === 200 && r.json.isSubscriber === true && r.json.adFree === false && appAdsOn(r.json), r.json && { isSubscriber: r.json.isSubscriber, adFree: r.json.adFree });
  r = await page(ID.film, premium);
  ok('Premium: ad-free → no ads', r.status === 200 && r.json.adFree === true && !appAdsOn(r.json), r.json && { isSubscriber: r.json.isSubscriber, adFree: r.json.adFree });

  r = await page(ID.film, { userId: null, token: null });
  ok('signed out: ads (the website’s rule)', r.status === 200 && r.json.adFree === false && r.json.isAdmin === false && appAdsOn(r.json), `${r.status} ${r.text.slice(0, 160)}`);

  r = await page(ID.plan, viewer);
  const plan = r.json && r.json.episode && r.json.episode.adPlan;
  ok('a ready plan rides on the episode', plan && Array.isArray(plan.breaks) && plan.breaks.length === 2 && plan.breaks[0].at === 0 && plan.breaks[1].at === 600, plan);
  const breaks = titleBreaks({ adsOn: appAdsOn(r.json), adPlan: plan, adBreakSeconds: r.json && r.json.episode.adBreakSeconds });
  ok('…its breaks replace the plain ones (300 gone)', JSON.stringify(breaks) === JSON.stringify([{ at: 0, index: 0 }, { at: 600, index: 1 }]), breaks);
  ok('…its pre-roll is the plan’s fill', titleSlot(preRollOf(breaks), ID.plan).path === `/api/ad-plan/fill?episode=${ID.plan}&break=0&surface=vod`);
  return { viewer, standard, premium };
}

async function pickAndPixel() {
  section('The pick and its signed pixel (ad share for app plays)');
  const path = titleSlot({ at: 0, index: null }, ID.film).path;
  ok('the app’s pre-roll asks the pick with the title and surface', path === `/api/house-ads/pick?placement=main_player&episode=${ID.film}&surface=preroll`, path);
  let r = await call(path, app(DEE));
  const ad = r.json && r.json.ad;
  ok('the pick answers the house ad', r.status === 200 && ad && ad.id === AD.house && /^https:\/\//.test(ad.videoUrl), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…with its length, brand, link and click tracker', ad && ad.seconds === 15 && ad.brand === 'Kettle Coffee' && ad.clickUrl === 'https://kettle.example.com/' && ad.clickTrackUrl === `/api/house-ads/click?ad=${AD.house}`, ad);
  const u = new URL(ad.impressionUrl, 'http://x');
  ok('…and a signed impression that names the title and surface', u.pathname === '/api/house-ads/impression' && u.searchParams.get('ad') === AD.house && u.searchParams.get('episode') === ID.film && u.searchParams.get('surface') === 'preroll' && u.searchParams.get('sig') && u.searchParams.get('n') && u.searchParams.get('exp'), ad.impressionUrl);

  const before = counter(AD.house, 'impressions');
  const a = await person('adspx');
  r = await pixel(ad.impressionUrl, a);
  ok('firing it answers the gif', r.status === 200 && /image\/gif/.test(r.headers.get('content-type') || ''), `${r.status} ${r.headers.get('content-type')}`);
  let got = imp(AD.house, ID.film);
  ok('…records the title’s ad_impression_days row (preroll, 1)', got.length === 1 && got[0].surface === 'preroll' && got[0].n === 1, got);
  ok('…and counts the advertiser’s impression', counter(AD.house, 'impressions') === before + 1, counter(AD.house, 'impressions'));

  const b = await person('adsreplay');
  await pixel(ad.impressionUrl, b);
  got = imp(AD.house, ID.film);
  ok('the same pixel again (another viewer): counts nothing', got.length === 1 && got[0].n === 1 && counter(AD.house, 'impressions') === before + 1, { got, n: counter(AD.house, 'impressions') });

  const fresh = (await call(path, app(DEE))).json.ad.impressionUrl;
  const c = await person('adsforge');
  const forged = fresh.replace(`episode=${ID.film}`, `episode=${ID.off}`);
  await pixel(forged, c);
  ok('a forged title on a signed pixel: nothing for either title', imp(AD.house, ID.off).length === 0 && imp(AD.house, ID.film)[0].n === 1 && counter(AD.house, 'impressions') === before + 1);
  await pixel(fresh.replace('surface=preroll', 'surface=live'), c);
  ok('a forged surface: nothing', imp(AD.house, ID.film).length === 1 && imp(AD.house, ID.film)[0].n === 1 && counter(AD.house, 'impressions') === before + 1, imp(AD.house, ID.film));
  await pixel(`/api/house-ads/impression?ad=${AD.house}&episode=${ID.film}&surface=preroll`, c);
  ok('an unsigned pixel: nothing', imp(AD.house, ID.film)[0].n === 1 && counter(AD.house, 'impressions') === before + 1);
  const expired = new URL(fresh, 'http://x');
  expired.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
  await pixel(`${expired.pathname}?${expired.searchParams}`, c);
  ok('an expired one: nothing', imp(AD.house, ID.film)[0].n === 1 && counter(AD.house, 'impressions') === before + 1);
  // The untouched fresh one still counts for a new viewer (its nonce is unused).
  await pixel(fresh, c);
  ok('the fresh pixel itself still counts (2)', imp(AD.house, ID.film)[0].n === 2 && counter(AD.house, 'impressions') === before + 2, imp(AD.house, ID.film));

  // The creator's own play: the advertiser's impression counts, the title's share doesn't.
  const own = (await call(path, app(DEE))).json.ad.impressionUrl;
  await pixel(own, DEE);
  ok('Dee playing her own title: the advertiser’s impression counts, no ad share', imp(AD.house, ID.film)[0].n === 2 && counter(AD.house, 'impressions') === before + 3, { got: imp(AD.house, ID.film), n: counter(AD.house, 'impressions') });

  section('The pick without a title');
  r = await call(adPickPath({ placement: 'main_player', episodeId: ID.film }), app(DEE));
  ok('a title without a surface: the impression names no title', r.json.ad && !/episode=/.test(r.json.ad.impressionUrl) && !/surface=/.test(r.json.ad.impressionUrl), r.json.ad && r.json.ad.impressionUrl);
  r = await call(`/api/house-ads/pick?placement=main_player&episode=${encodeURIComponent('../etc')}&surface=preroll`, app(DEE));
  ok('a malformed title id: the impression names no title', r.json.ad && !/episode=/.test(r.json.ad.impressionUrl), r.json.ad && r.json.ad.impressionUrl);
  r = await call(reelSlot().path, app(DEE));
  ok('the reel card’s pick (vertical_discover): signed, no title, no surface', r.status === 200 && r.json.ad && /sig=/.test(r.json.ad.impressionUrl) && !/episode=/.test(r.json.ad.impressionUrl) && !/surface=/.test(r.json.ad.impressionUrl), r.json.ad && r.json.ad.impressionUrl);
  const reelViewer = await person('adsreel');
  const n0 = counter(AD.house, 'impressions');
  await pixel(r.json.ad.impressionUrl, reelViewer);
  ok('…its pixel counts the advertiser’s impression and no title', counter(AD.house, 'impressions') === n0 + 1 && rows(`select count(*)::int as n from public.ad_impression_days where ad_id = ${q(AD.house)}`)[0].n === 1, rows(`select episode_id, surface, impressions from public.ad_impression_days where ad_id = ${q(AD.house)}`));
  r = await call(liveSlot({ kind: 'between', episodeId: ID.film }).path, app(DEE));
  ok('a live break between programs: signed with the title and surface live', r.json.ad && /surface=live/.test(r.json.ad.impressionUrl) && new URL(r.json.ad.impressionUrl, 'http://x').searchParams.get('episode') === ID.film, r.json.ad && r.json.ad.impressionUrl);
  r = await call(liveSlot({ kind: 'scheduled' }).path, app(DEE));
  ok('a scheduled live break: no title', r.json.ad && !/episode=/.test(r.json.ad.impressionUrl), r.json.ad && r.json.ad.impressionUrl);

  section('Brands');
  sql(`update public.house_ads set active = false where id = ${q(AD.house)}`);
  sql(`update public.house_ads set active = true where id = ${q(AD.advertiser)}`);
  r = await call(path, app(DEE));
  ok('an advertiser’s ad: the brand is the account’s company', r.json.ad && r.json.ad.id === AD.advertiser && r.json.ad.brand === `Harbor Bikes ${RUN}`, r.json.ad);
  sql(`update public.house_ads set active = false where id = ${q(AD.advertiser)}`);
  r = await call(path, app(DEE));
  ok('nothing active: { ad: null } (the app plays the title)', r.status === 200 && r.json.ad === null, r.text.slice(0, 120));
  sql(`update public.house_ads set active = true where id = ${q(AD.house)}`);

  section('The click tracker');
  const clicks = counter(AD.house, 'clicks');
  const clicker = await person('adsclick');
  r = await call(`/api/house-ads/click?ad=${AD.house}`, { ...app(clicker), accept: 'image/gif', headers: { 'X-Forwarded-For': ip(clicker) } });
  ok('a click answers the gif and counts once', r.status === 200 && counter(AD.house, 'clicks') === clicks + 1, { status: r.status, clicks: counter(AD.house, 'clicks') });
  await call(`/api/house-ads/click?ad=${AD.house}`, { ...app(clicker), accept: 'image/gif', headers: { 'X-Forwarded-For': ip(clicker) } });
  ok('…a second within ten minutes doesn’t', counter(AD.house, 'clicks') === clicks + 1);
}

async function planFill() {
  section('A ready plan’s break (/api/ad-plan/fill)');
  const vod = titleSlot({ at: 600, index: 1 }, ID.plan);
  let r = await call(vod.path, app(DEE));
  const items = r.json && r.json.fill && r.json.fill.items;
  ok('break 1, on demand: the house ad, 15 s', r.status === 200 && Array.isArray(items) && items.length === 1 && items[0].type === 'ad' && items[0].id === AD.house && items[0].seconds === 15, `${r.status} ${r.text.slice(0, 300)}`);
  ok('…with its brand, link and click tracker', items && items[0].brand === 'Kettle Coffee' && items[0].clickUrl === 'https://kettle.example.com/' && /\/api\/house-ads\/click\?ad=/.test(items[0].clickTrackUrl), items && items[0]);
  const u = items && new URL(items[0].impressionUrl);
  ok('…its pixel signed for the title and surface vod', u && u.searchParams.get('episode') === ID.plan && u.searchParams.get('surface') === 'vod' && u.searchParams.get('sig'), items && items[0].impressionUrl);
  const v = await person('adsvod');
  await pixel(items[0].impressionUrl, v);
  let got = imp(AD.house, ID.plan);
  ok('…firing it records a vod row for the title', got.length === 1 && got[0].surface === 'vod' && got[0].n === 1, got);

  r = await call(liveSlot({ kind: 'plan', episodeId: ID.plan, breakIndex: 1 }).path, app(DEE));
  const live = r.json && r.json.fill && r.json.fill.items;
  ok('the same break on a live channel: signed for surface live', live && live[0] && new URL(live[0].impressionUrl).searchParams.get('surface') === 'live', r.text.slice(0, 300));
  const l = await person('adslive');
  await pixel(live[0].impressionUrl, l);
  got = imp(AD.house, ID.plan);
  ok('…firing it records a live row', got.length === 2 && got.some((x) => x.surface === 'live' && x.n === 1), got);

  r = await call(titleSlot({ at: 0, index: 0 }, ID.plan).path, app(DEE));
  ok('the plan’s pre-roll (break 0) fills too', r.json && r.json.fill && r.json.fill.items.length === 1, r.text.slice(0, 200));
  r = await call(`/api/ad-plan/fill?episode=${ID.film}&break=0&surface=vod`, app(DEE));
  ok('a title without a plan: { fill: null } (the app plays the title)', r.status === 200 && r.json && r.json.fill === null, r.text.slice(0, 160));
  r = await call(`/api/ad-plan/fill?episode=${ID.plan}&break=9&surface=vod`, app(DEE));
  ok('a break that isn’t there: { fill: null }', r.status === 200 && r.json && r.json.fill === null, r.text.slice(0, 160));
}

async function feeds({ viewer, premium }) {
  section('The swipe feeds’ ad cards');
  let r = await call('/api/vertical-discover-feed?terms=1', app(viewer));
  ok('Vertical Discover: a viewer gets the cards (adsOn true)', r.status === 200 && r.json.adsOn === true && reelAdsOn({}) === true, `${r.status} ${r.json && r.json.adsOn}`);
  r = await call('/api/vertical-discover-feed?terms=1', app(premium));
  ok('…a Premium member doesn’t', r.status === 200 && r.json.adsOn === false, r.json && r.json.adsOn);
  r = await call('/api/vertical-discover-feed?terms=1', app(ADMIN));
  ok('…nor the team', r.status === 200 && r.json.adsOn === false, r.json && r.json.adsOn);
  r = await call('/api/snippets-feed', app(viewer));
  ok('Snippets: a viewer gets the cards', r.status === 200 && r.json.adsOn === true, `${r.status} ${r.json && r.json.adsOn}`);
  r = await call('/api/snippets-feed', app(premium));
  ok('…a Premium member doesn’t (the website showed them to everyone)', r.status === 200 && r.json.adsOn === false, r.json && r.json.adsOn);
  r = await call('/api/snippets-feed', app(ADMIN));
  ok('…nor the team', r.status === 200 && r.json.adsOn === false, r.json && r.json.adsOn);
}

// The website's two swipe feeds read the same rule now (lib/adBreakRules.js
// REEL_AD_EVERY / reelAdsOn): they still load in a browser without errors,
// and Snippets no longer hands the team its ad cards.
async function websiteFeeds() {
  section('The website’s swipe feeds in a browser');
  let b = null;
  try {
    b = await browser();
  } catch (err) {
    ok('Chromium (playwright) is there', false, String(err && err.message).slice(0, 200));
    return;
  }
  try {
    for (const [who, label, want] of [[SIGNED_OUT, 'signed out', true], [ADMIN, 'the team', false]]) {
      for (const path of ['/snippets/discover', '/vertical/discover']) {
        const { ctx, page: pg, errors } = await b.open(who, 390);
        const status = await goto(pg, path);
        const adsOn = await pg.evaluate(() => {
          const el = document.getElementById('__NEXT_DATA__');
          try { return JSON.parse(el.textContent).props.pageProps.adsOn; } catch (err) { return undefined; }
        });
        ok(`${path} at 390, ${label}: 200, no page errors, adsOn ${want}`, status === 200 && errors.length === 0 && adsOn === want, { status, errors, adsOn });
        await ctx.close();
      }
    }
  } finally {
    await b.close();
  }
}

await runCheck('app-house-ads', async () => {
  try {
    seed();
    const who = await whoGetsAds();
    await pickAndPixel();
    await planFill();
    await feeds(who);
    await websiteFeeds();
  } finally {
    await cleanup();
  }
});
