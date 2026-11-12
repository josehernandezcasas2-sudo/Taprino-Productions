import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUDIO_KEY_SECONDS, AUDIO_KEY_MODES, parseAudioKey } from './podcastAudioRules.js';

// SERVER-ONLY. The keys on the podcast audio route's addresses
// (lib/podcastAudioRules.js says how it fits together; Jose, 2026-11-12).
// Imports nothing but node:crypto and the rules, so the tests can load it
// (scripts/test-podcast-audio.mjs).
//
// A key is an HMAC over the episode, the expiry and who it was minted for,
// with a key derived from a secret the deployment already has
// (PODCAST_AUDIO_SECRET when set), the way the ad impression pixels are
// signed (lib/adImpressionSig.js). Without any secret (a bare local run)
// no key is minted and the route falls back to the playback gate.

function signingKey() {
  const base = process.env.PODCAST_AUDIO_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CLERK_SECRET_KEY || '';
  if (!base) return null;
  return createHmac('sha256', base).update('studio-tapa:podcast-audio:v1').digest();
}

function mac(key, id, exp, mode) {
  return createHmac('sha256', key).update(`${id}|${exp}|${mode}`).digest('base64url');
}

// "<exp>.<mode>.<sig>", or null when nothing can be signed.
export function mintAudioKey(id, mode = 'v', { now = Date.now(), lifetimeSeconds = AUDIO_KEY_SECONDS } = {}) {
  const key = signingKey();
  if (!key || !id || !AUDIO_KEY_MODES.includes(mode)) return null;
  const exp = Math.floor(now / 1000) + lifetimeSeconds;
  return `${exp}.${mode}.${mac(key, id, exp, mode)}`;
}

// The mode a key was minted for ('v' | 'p' | 't'), or null for a key that
// isn't ours, is for another episode, or has run out (or claims to last
// longer than any key is minted for).
export function verifyAudioKey(id, raw, { now = Date.now() } = {}) {
  const parsed = parseAudioKey(raw);
  const key = signingKey();
  if (!parsed || !key || !id) return null;
  const nowSeconds = Math.floor(now / 1000);
  if (parsed.exp < nowSeconds || parsed.exp > nowSeconds + AUDIO_KEY_SECONDS + 60) return null;
  const want = Buffer.from(mac(key, id, parsed.exp, parsed.mode));
  const got = Buffer.from(parsed.sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return parsed.mode;
}
