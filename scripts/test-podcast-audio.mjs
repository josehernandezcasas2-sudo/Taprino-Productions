// node scripts/test-podcast-audio.mjs — podcast audio behind one route
// (2026-11-12): the addresses and stored paths (lib/podcastAudioRules.js),
// the feed's listing rule the route shares, the keys and what still plays
// for them (lib/podcastAudioKeys.js).
import assert from 'node:assert/strict';
import {
  PODCAST_AUDIO_ROUTE, AUDIO_KEY_SECONDS, audioExtensionOf, audioMimeType, podcastAudioPath, parseAudioRouteId,
  audioStoragePath, isExternalAudio, rssListsEpisode, parseAudioKey, keyStillAllows
} from '../lib/podcastAudioRules.js';

let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };
const BASE = 'https://abc.supabase.co';
const stored = (path) => `${BASE}/storage/v1/object/public/episode-audio/${path}`;

await t('the extension comes from the stored path, mp3 otherwise', () => {
  assert.equal(audioExtensionOf(stored('podcast-x.m4a')), 'm4a');
  assert.equal(audioExtensionOf(stored('podcast-x.MP3')), 'mp3');
  assert.equal(audioExtensionOf('https://cdn.example.com/a.ogg?token=1.m4a'), 'ogg', 'the query never decides');
  assert.equal(audioExtensionOf('https://cdn.example.com/listen'), 'mp3');
  assert.equal(audioExtensionOf('https://cdn.example.com/a.exe'), 'mp3');
  assert.equal(audioExtensionOf(null), 'mp3');
  assert.equal(audioMimeType('m4a'), 'audio/mp4');
  assert.equal(audioMimeType('weba'), 'audio/webm');
  assert.equal(audioMimeType('constructor'), 'audio/mpeg', 'no prototype keys');
});

await t('the route address', () => {
  assert.equal(PODCAST_AUDIO_ROUTE, '/api/podcasts/audio');
  assert.equal(podcastAudioPath('night-bus-e1-lx3k9a'), '/api/podcasts/audio/night-bus-e1-lx3k9a.mp3');
  assert.equal(podcastAudioPath('ep1', { ext: 'm4a' }), '/api/podcasts/audio/ep1.m4a');
  assert.equal(podcastAudioPath('ep1', { ext: 'exe' }), '/api/podcasts/audio/ep1.mp3');
  assert.equal(podcastAudioPath('ep1', { key: '1800000000.v.abc' }), '/api/podcasts/audio/ep1.mp3?k=1800000000.v.abc');
  assert.equal(podcastAudioPath('-lx3k9a'), '/api/podcasts/audio/-lx3k9a.mp3', 'an older id with a leading dash');
  for (const bad of ['', 'a/b', 'a.b', '../x', null, 'a b']) assert.equal(podcastAudioPath(bad), null, String(bad));
});

await t('the route segment: id with or without a known extension', () => {
  assert.deepEqual(parseAudioRouteId('ep1'), { id: 'ep1', ext: null });
  assert.deepEqual(parseAudioRouteId('ep1.mp3'), { id: 'ep1', ext: 'mp3' });
  assert.deepEqual(parseAudioRouteId('ep1.M4A'), { id: 'ep1', ext: 'm4a' });
  assert.deepEqual(parseAudioRouteId('night-bus_e1.ogg'), { id: 'night-bus_e1', ext: 'ogg' });
  for (const bad of ['ep1.exe', 'ep1.mp3.mp3', '.mp3', '', 'a/b.mp3', 'ep1.', '%2e%2e.mp3', 'ep 1.mp3', undefined, ['ep1']]) assert.equal(parseAudioRouteId(bad), null, String(bad));
});

await t('a stored address in our bucket → its path; anything else → null', () => {
  assert.equal(audioStoragePath(stored('podcast-lx-ab12.mp3'), BASE), 'podcast-lx-ab12.mp3');
  assert.equal(audioStoragePath(stored('podcast-lx-ab12.mp3'), `${BASE}/`), 'podcast-lx-ab12.mp3', 'a trailing slash on the base');
  assert.equal(audioStoragePath(`${BASE}/storage/v1/object/sign/episode-audio/a.mp3?token=x`, BASE), 'a.mp3');
  assert.equal(audioStoragePath(`${BASE}/storage/v1/object/authenticated/episode-audio/dir/a.mp3`, BASE), 'dir/a.mp3');
  assert.equal(audioStoragePath(stored('my%20show.mp3'), BASE), 'my show.mp3');
  assert.equal(audioStoragePath(`${BASE}/storage/v1/object/public/episode-art/a.mp3`, BASE), null, 'another bucket');
  assert.equal(audioStoragePath('https://other.supabase.co/storage/v1/object/public/episode-audio/a.mp3', BASE), null, 'another project');
  assert.equal(audioStoragePath('https://cdn.example.com/a.mp3', BASE), null);
  assert.equal(audioStoragePath(stored('../secret.mp3'), BASE), null);
  assert.equal(audioStoragePath(stored('a/%2e%2e/b.mp3'), BASE), null, 'an encoded climb');
  assert.equal(audioStoragePath(stored('a//b.mp3'), BASE), null);
  assert.equal(audioStoragePath(stored('%E0%A4%A.mp3'), BASE), null, 'bad encoding');
  assert.equal(audioStoragePath(stored('a%5Cb.mp3'), BASE), null, 'a backslash');
  assert.equal(audioStoragePath(stored('a.mp3'), ''), null, 'no Supabase configured');
  assert.equal(audioStoragePath(null, BASE), null);
  assert.equal(isExternalAudio('https://cdn.example.com/a.mp3'), true);
  assert.equal(isExternalAudio('http://cdn.example.com/a.mp3'), false, 'https only');
  assert.equal(isExternalAudio('javascript:alert(1)'), false);
  assert.equal(isExternalAudio('https://cdn.example.com/a b.mp3'), false);
});

const free = { content_type: 'podcast', status: 'approved', tier: 'free', audio_url: stored('a.mp3'), moderation_hold: false, deletion_requested: false, withdrawn_at: null, available_until: null };
const NOW = Date.parse('2026-11-12T12:00:00Z');

await t('what the public feed lists (and so the route opens to anyone)', () => {
  const ok = { showPublic: true, termsClear: true, now: NOW };
  assert.equal(rssListsEpisode(free, ok), true);
  assert.equal(rssListsEpisode(free, { ...ok, showPublic: false }), false, 'a private show');
  assert.equal(rssListsEpisode(free, { ...ok, termsClear: false }), false, '17+ or unrated');
  for (const [k, v] of [['tier', 'premium'], ['status', 'pending'], ['status', 'rejected'], ['content_type', 'film'], ['audio_url', null], ['moderation_hold', true], ['deletion_requested', true], ['withdrawn_at', '2026-11-01T00:00:00Z'], ['available_until', '2026-11-12T11:59:00Z']]) {
    assert.equal(rssListsEpisode({ ...free, [k]: v }, ok), false, `${k}=${v}`);
  }
  assert.equal(rssListsEpisode({ ...free, available_until: '2026-12-01T00:00:00Z' }, ok), true, 'still available');
  assert.equal(rssListsEpisode(null, ok), false);
  assert.equal(rssListsEpisode(free), false, 'nothing proven, nothing listed');
});

await t('a key is "<exp>.<mode>.<sig>"', () => {
  assert.deepEqual(parseAudioKey('1800000000.v.abcdefghijklmnopqrstuvwxyz'), { exp: 1800000000, mode: 'v', sig: 'abcdefghijklmnopqrstuvwxyz' });
  for (const bad of ['', '1800000000.x.abcdefghijklmnopqrstuv', '18.v.abcdefghijklmnopqrstuv', '1800000000.v.short', '1800000000.v.abc def ghi jkl mno pqr', '1800000000.v.abcdefghijklmnopqrstuv.extra', null, 42]) {
    assert.equal(parseAudioKey(bad), null, String(bad));
  }
});

await t('what still plays for a key once the episode changes', () => {
  assert.equal(keyStillAllows('v', free, NOW), true);
  assert.equal(keyStillAllows('v', { ...free, tier: 'premium' }, NOW), true, 'the tier was decided when it was minted');
  for (const change of [{ moderation_hold: true }, { deletion_requested: true }, { status: 'pending' }, { status: 'rejected' }, { withdrawn_at: '2026-11-11T00:00:00Z' }, { available_until: '2026-11-12T11:00:00Z' }, { audio_url: null }]) {
    assert.equal(keyStillAllows('v', { ...free, ...change }, NOW), false, JSON.stringify(change));
  }
  const pending = { ...free, status: 'pending' };
  assert.equal(keyStillAllows('p', pending, NOW), true, 'the owner hears an episode in review');
  assert.equal(keyStillAllows('p', { ...pending, moderation_hold: true }, NOW), false, 'held: the team only');
  assert.equal(keyStillAllows('p', { ...pending, status: 'rejected' }, NOW), false, 'declined never previews');
  assert.equal(keyStillAllows('t', { ...pending, moderation_hold: true }, NOW), true, 'the team hears a held one');
  assert.equal(keyStillAllows('t', { ...pending, status: 'rejected' }, NOW), false);
  assert.equal(keyStillAllows('t', { ...pending, withdrawn_at: '2026-11-11T00:00:00Z' }, NOW), false);
  assert.equal(keyStillAllows('x', free, NOW), false);
  assert.equal(keyStillAllows('v', null, NOW), false);
});

// The keys need a secret; the tests bring their own.
process.env.PODCAST_AUDIO_SECRET = 'test-secret-for-the-audio-keys';
const { mintAudioKey, verifyAudioKey } = await import('../lib/podcastAudioKeys.js');

await t('a minted key verifies for its episode and mode only', () => {
  const key = mintAudioKey('ep1', 'v', { now: NOW });
  assert.ok(parseAudioKey(key), key);
  assert.equal(verifyAudioKey('ep1', key, { now: NOW }), 'v');
  assert.equal(verifyAudioKey('ep1', key, { now: NOW + (AUDIO_KEY_SECONDS - 5) * 1000 }), 'v', 'good until it runs out');
  assert.equal(verifyAudioKey('ep1', key, { now: NOW + (AUDIO_KEY_SECONDS + 5) * 1000 }), null, 'run out');
  assert.equal(verifyAudioKey('ep2', key, { now: NOW }), null, 'another episode');
  assert.equal(verifyAudioKey('ep1', key.replace('.v.', '.t.'), { now: NOW }), null, 'the mode is signed');
  const [exp, mode, sig] = key.split('.');
  assert.equal(verifyAudioKey('ep1', `${Number(exp) + 60}.${mode}.${sig}`, { now: NOW }), null, 'the expiry is signed');
  assert.equal(verifyAudioKey('ep1', `${exp}.${mode}.${sig.slice(0, -2)}AA`, { now: NOW }), null);
  assert.equal(verifyAudioKey('ep1', mintAudioKey('ep1', 't', { now: NOW }), { now: NOW }), 't');
  assert.equal(verifyAudioKey('ep1', mintAudioKey('ep1', 'p', { now: NOW }), { now: NOW }), 'p');
  assert.equal(mintAudioKey('ep1', 'admin', { now: NOW }), null, 'unknown modes are never minted');
  const long = mintAudioKey('ep1', 'v', { now: NOW, lifetimeSeconds: AUDIO_KEY_SECONDS * 4 });
  assert.equal(verifyAudioKey('ep1', long, { now: NOW }), null, 'a key claiming to last longer than any is minted for');
  assert.equal(verifyAudioKey('ep1', '', { now: NOW }), null);
  assert.equal(verifyAudioKey('ep1', undefined, { now: NOW }), null);
});

await t('another deployment’s key is refused, and with no secret nothing is minted', async () => {
  const key = mintAudioKey('ep1', 'v', { now: NOW });
  process.env.PODCAST_AUDIO_SECRET = 'a-different-secret';
  assert.equal(verifyAudioKey('ep1', key, { now: NOW }), null);
  const saved = { a: process.env.PODCAST_AUDIO_SECRET, b: process.env.SUPABASE_SERVICE_ROLE_KEY, c: process.env.CLERK_SECRET_KEY };
  delete process.env.PODCAST_AUDIO_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
  assert.equal(mintAudioKey('ep1', 'v', { now: NOW }), null);
  assert.equal(verifyAudioKey('ep1', key, { now: NOW }), null);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-stand-in';
  assert.ok(mintAudioKey('ep1', 'v', { now: NOW }), 'derived from the service-role key when there is no audio secret');
  if (saved.a) process.env.PODCAST_AUDIO_SECRET = saved.a;
  if (saved.b) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.b; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (saved.c) process.env.CLERK_SECRET_KEY = saved.c;
});

console.log(`${n} passed`);
