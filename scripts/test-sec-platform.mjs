// node scripts/test-sec-platform.mjs — the security fixes of 2026-11-15
// (platform, uploads and the app): the pure rules behind them.
//   lib/cssUrl.js            every picture address that goes into CSS
//   lib/uploadRefRules.js    a host's photos and proof, a performer's
//                            headshots, a private storage path
//   lib/pageSegments.js      the catch-all pages' 404 for file-like addresses
//   lib/likeLiteral.js       PostgREST's `*` wildcard
//   lib/privateAddressRules.js  addresses a fetched link may resolve to
//   lib/videoRefreshRules.js which uploads a list asks Cloudflare about
//   lib/urlValidation.js     imports from the site's own media hosts
//   lib/capabilities.js      a team account the two-step requirement keeps out
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssUrl, cssUrlAllowed } from '../lib/cssUrl.js';
import { isOwnLocationPhoto, isSafeStoredLocationUpload, isLocationProofRef, isOwnHeadshot, safePrivatePath, publicArtFileName } from '../lib/uploadRefRules.js';
import { segmentsRefused } from '../lib/pageSegments.js';
import { likeLiteral, hasLikeStar } from '../lib/likeLiteral.js';
import { privateAddress, ipv6Words } from '../lib/privateAddressRules.js';
import { shouldRefreshVideo, latestStamp, REFRESH_FOR_MS } from '../lib/videoRefreshRules.js';
import { isOwnMediaHost, validateRemoteVideoUrl } from '../lib/urlValidation.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('cssUrl: a plain address is quoted', () => {
  assert.equal(cssUrl('https://x.supabase.co/storage/v1/object/public/episode-art/a.jpg'), 'url("https://x.supabase.co/storage/v1/object/public/episode-art/a.jpg")');
  assert.equal(cssUrl('/api/posts/abc/media?kind=photo'), 'url("/api/posts/abc/media?kind=photo")');
  assert.equal(cssUrl('blob:https://www.studiotapatv.site/1234-abcd'), 'url("blob:https://www.studiotapatv.site/1234-abcd")');
  assert.equal(cssUrl('data:image/jpeg;base64,AAAA'), 'url("data:image/jpeg;base64,AAAA")');
});

t('cssUrl: nothing in the address can end the url() or the declaration', () => {
  const evil = 'https://x.supabase.co/a.jpg");position:fixed;inset:0;background:url("https://evil.example/fake-sign-in.png';
  const out = cssUrl(evil);
  assert.ok(out.startsWith('url("') && out.endsWith('")'));
  // Every quote inside is escaped, so the string never closes early.
  assert.equal(out.slice(5, -2).replace(/\\"/g, '').includes('"'), false, out);
  assert.equal(cssUrl('https://x/a\\'), 'url("https://x/a\\\\")', 'a trailing backslash can’t escape the closing quote');
  const nl = cssUrl('https://x/a.jpg\n;position:fixed');
  assert.equal(/[\n\r]/.test(nl), false, 'a newline becomes a CSS escape');
  assert.ok(nl.includes('\\a '), nl);
  assert.equal(/[\u0000-\u001f]/.test(cssUrl('https://x/a\u0000b\u000cc')), false);
});

t('cssUrl: anything that isn’t a picture address is none', () => {
  for (const v of [null, undefined, '', '   ', 42, {}, 'javascript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/a.png', '/\\evil.example/a.png', 'ftp://x/a.jpg', 'a.jpg', 'expression(alert(1))']) {
    assert.equal(cssUrl(v), 'none', String(v));
    assert.equal(cssUrlAllowed(v), false, String(v));
  }
});

const SB = 'https://abcd.supabase.co';
const ART = `${SB}/storage/v1/object/public/episode-art`;
const HOST = 'user_2abcDEF123';

t('location photos: only the host’s own upload, exactly', () => {
  assert.equal(isOwnLocationPhoto(`${ART}/location-photo-${HOST}-0a1b2c3d4e5f6a7b8c.jpg`, HOST, SB), true);
  assert.equal(isOwnLocationPhoto(`${ART}/location-photo-${HOST}-1729000000000.webp`, HOST, SB), true, 'an older timestamp name');
  const bad = [
    `${ART}/location-photo-${HOST}-0a1b.jpg");position:fixed;inset:0;background:url("https://evil.example/x.png`,
    `${ART}/location-photo-${HOST}-0a1b.jpg?x=1`,
    `${ART}/location-photo-${HOST}-0a1b.jpg#x`,
    `${ART}/location-photo-${HOST}-0a1b.jpg )`,
    `${ART}/location-photo-user_someoneElse-0a1b.jpg`,
    `${ART}/location-photo-${HOST}x-0a1b.jpg`,
    `${ART}/location-photo-${HOST}-0a1b.svg`,
    `${ART}/location-proof-${HOST}-0a1b.jpg`,
    `${ART}/sub/location-photo-${HOST}-0a1b.jpg`,
    `${SB}/storage/v1/object/public/other-bucket/location-photo-${HOST}-0a1b.jpg`,
    `https://evil.example/storage/v1/object/public/episode-art/location-photo-${HOST}-0a1b.jpg`,
    `https://abcd.supabase.co.evil.example/storage/v1/object/public/episode-art/location-photo-${HOST}-0a1b.jpg`,
    `https://user@abcd.supabase.co/storage/v1/object/public/episode-art/location-photo-${HOST}-0a1b.jpg`,
    `${ART}/location-photo-${HOST}-0a1b.jpg\n`,
    `${ART}/location-photo-${HOST}-0a%22b.jpg`,
    `${ART}/location-photo-${HOST}-0a1b.jpg\\`,
    null, 42
  ];
  for (const u of bad) assert.equal(isOwnLocationPhoto(u, HOST, SB), false, String(u));
  assert.equal(isOwnLocationPhoto(`${ART}/location-photo-${HOST}-0a1b.jpg`, null, SB), false, 'no host id, no photo');
  assert.equal(isOwnLocationPhoto(`${ART}/location-photo-${HOST}-0a1b.jpg`, HOST, ''), false, 'no storage configured');
  assert.equal(publicArtFileName(`${ART}/location-photo-${HOST}-0a1b.jpg`, `${SB}/`), `location-photo-${HOST}-0a1b.jpg`, 'a trailing slash on the setting');
});

t('location photos already on a listing: kept while they are plain storage addresses', () => {
  assert.equal(isSafeStoredLocationUpload(`${ART}/location-${HOST}-photo-1.jpg`, SB), true);
  assert.equal(isSafeStoredLocationUpload(`${ART}/location-photo-x.jpg");inset:0`, SB), false);
  assert.equal(isSafeStoredLocationUpload('https://evil.example/location-x.jpg', SB), false);
});

t('ownership proof: the host’s own private reference, or an older public one', () => {
  assert.equal(isLocationProofRef(`private:location-proof-${HOST}-0a1b2c3d4e5f6a7b8c.png`, HOST, SB), true);
  assert.equal(isLocationProofRef(`${ART}/location-proof-${HOST}-0a1b2c.jpg`, HOST, SB), true);
  for (const v of [
    'private:location-proof-/../../university-docs/secret.pdf',
    `private:location-proof-${HOST}-/../../episode-audio/x.mp3`,
    `private:location-proof-${HOST}-0a1b.png/../x`,
    `private:location-proof-user_other-0a1b.png`,
    `private:captions/${HOST}-0a1b.vtt`,
    `private:location-proof-${HOST}-0a%2e%2e.png`,
    `${ART}/location-photo-${HOST}-0a1b.jpg`
  ]) assert.equal(isLocationProofRef(v, HOST, SB), false, v);
});

t('private storage paths: nothing that reaches outside its folder', () => {
  for (const p of ['captions/night-bus-lx3k9a-1729000000000.vtt', 'posts/user_abc-1729-photo-0a1b.webp', `location-proof-${HOST}-0a1b.png`]) assert.equal(safePrivatePath(p), p, p);
  for (const p of ['', null, '../x', 'a/../b', 'a\\b', 'a%2e%2e/b', '/abs', 'a//b', 'a\nb', 'a\u0000b', 'x'.repeat(501)]) assert.equal(safePrivatePath(p), null, String(p));
});

t('headshots: only this account’s own upload', () => {
  assert.equal(isOwnHeadshot(`${ART}/headshot-${HOST}-0a1b2c3d4e5f6a7b8c.jpg`, HOST, SB), true);
  for (const u of [
    `https://tracker.example/pixel.gif?headshot-${HOST}`,
    `https://evil.example/headshot-${HOST}-0a1b.jpg`,
    `${ART}/headshot-user_other-0a1b.jpg`,
    `${ART}/headshot-${HOST}-0a1b.jpg?v=2`,
    `${ART}/location-photo-${HOST}-0a1b.jpg`
  ]) assert.equal(isOwnHeadshot(u, HOST, SB), false, u);
});

t('catch-all pages: a file-like or extra segment is a 404', () => {
  for (const s of [undefined, null, [], ['new'], ['b1d0c1e2-0000-4000-8000-000000000001']]) assert.equal(segmentsRefused(s), false, JSON.stringify(s));
  for (const s of [['x.css'], ['new', 'x'], ['a', 'b.png'], 'x.js', ['..']]) assert.equal(segmentsRefused(s), true, JSON.stringify(s));
});

t('likeLiteral: % _ \\ and * never act as wildcards', () => {
  assert.equal(likeLiteral('a%b_c\\d*e'), 'a\\%b\\_c\\\\d\\*e');
  assert.equal(hasLikeStar('jo*@example.com'), true);
  assert.equal(hasLikeStar('jo@example.com'), false);
});

t('fetched links: private and IPv4-carrying IPv6 addresses are refused', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '100.64.0.1', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', '::7f00:1', '::8.8.8.8', '64:ff9b::7f00:1', '64:ff9b::8.8.8.8', '64:ff9b:1::1', '2002:7f00:1::1', '2002::1', '2001::1', 'fc00::1', 'fd00::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '2001:db8::1', 'garbage', '']) assert.equal(privateAddress(a), true, a);
  for (const a of ['8.8.8.8', '1.1.1.1', '::ffff:8.8.8.8', '::ffff:808:808', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) assert.equal(privateAddress(a), false, a);
  assert.deepEqual(ipv6Words('::ffff:7f00:1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  assert.deepEqual(ipv6Words('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
});

t('drafts and applications: which uploads a list asks Cloudflare about', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const fresh = new Date(now - 3600000).toISOString();
  const stale = new Date(now - REFRESH_FOR_MS - 60000).toISOString();
  assert.equal(shouldRefreshVideo({ uid: 'abc', state: 'uploading', changedAt: fresh, now }), true);
  assert.equal(shouldRefreshVideo({ uid: 'abc', state: 'uploading', changedAt: stale, now }), false, 'an upload address a day old is gone');
  assert.equal(shouldRefreshVideo({ uid: 'abc', state: 'processing', changedAt: stale, now }), true, 'Cloudflare has the file: it finishes');
  for (const state of ['ready', 'error', 'deleted']) assert.equal(shouldRefreshVideo({ uid: 'abc', state, changedAt: fresh, now }), false, state);
  assert.equal(shouldRefreshVideo({ uid: null, state: 'uploading', changedAt: fresh, now }), false);
  assert.equal(latestStamp(null, '2026-11-01T00:00:00Z', 'nope', '2026-11-02T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z'));
});

t('link imports: never from the site’s own media hosts', () => {
  for (const u of ['https://customer-abc.cloudflarestream.com/uid/manifest/video.m3u8', 'https://videodelivery.net/uid/downloads/default.mp4', 'https://www.studiotapatv.site/api/podcasts/audio/ep1.mp3?key=x', 'https://studiotapatv.site/x.mp4', `${SB}/storage/v1/object/sign/episode-audio/x.mp3?token=y`]) {
    assert.equal(validateRemoteVideoUrl(u).ok, true, u);
    assert.equal(isOwnMediaHost(u, { supabaseUrl: SB }), true, u);
  }
  for (const u of ['https://files.example.com/film.mp4', 'https://cloudflarestream.com.evil.example/x.mp4', 'https://notstudiotapatv.site/x.mp4', 'not a url']) assert.equal(isOwnMediaHost(u, { supabaseUrl: SB }), false, u);
});

// lib/capabilities.js reads SITE from ./siteConfig (an extensionless import
// plain Node can't follow): loaded with that one line swapped for a stand-in.
const capSource = readFileSync(new URL('../lib/capabilities.js', import.meta.url), 'utf8').replace("import { SITE } from './siteConfig';", "const SITE = { name: 'Studio Tapa TV' };");
const cap = await import(`data:text/javascript;base64,${Buffer.from(capSource).toString('base64')}`);

t('two-step for the team: a blocked account passes no capability, whatever its role says', () => {
  const sub = { role: 'sub_admin', isSubAdmin: true, permissions: ['review_submissions'], isAdmin: false };
  assert.equal(cap.hasCapability(sub, 'review_submissions'), true);
  assert.equal(cap.hasCapability({ ...sub, isSubAdmin: false, adminNeedsTwoFactor: true }, 'review_submissions'), false, 'role and list still say sub-admin');
  assert.equal(cap.hasCapability({ isAdmin: true, adminNeedsTwoFactor: true }, 'review_submissions'), false);
  assert.equal(cap.hasCapability({ isAdmin: true }, 'review_submissions'), true);
  assert.deepEqual(cap.visibleCapabilities({ ...sub, adminNeedsTwoFactor: true }), []);
  assert.equal(cap.hasCapability(null, 'review_submissions'), false);
});

t('two-step for the team: both role readers carry no permissions for a blocked account', () => {
  for (const file of ['../lib/roles.js', '../lib/accountContext.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(/const permissions = !twoStep\.blocked && Array\.isArray\(meta\.permissions\) \? meta\.permissions : \[\];/.test(src), file);
  }
});

console.log(`\n${n} checks passed`);
