import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Signed impression pixels (security round, 2026-10-26). An impression
// spends an advertiser's credit and, with an episode attached, earns that
// title's creator ad share, and ad ids are public, so the pixel only
// counts a URL the server itself handed out: the VAST response, a plan
// pod or a reel ad card. The signature binds the ad, the title and the
// surface together, the URL expires, and its nonce counts once.
//
// The key is AD_IMPRESSION_SECRET when set, else derived from a secret
// the deployment already has, so nothing new has to be configured.

export const IMPRESSION_LIFETIME_SECONDS = 6 * 60 * 60;

function signingKey() {
  const base = process.env.AD_IMPRESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CLERK_SECRET_KEY || '';
  if (!base) return null;
  return createHmac('sha256', base).update('studio-tapa:ad-impression:v1').digest();
}

function mac(key, { ad, episode, surface, exp, nonce }) {
  return createHmac('sha256', key).update([ad, episode || '', surface || '', exp, nonce].join('|')).digest('base64url');
}

// The pixel path with its query, ready to put after the site's origin.
export function signedImpressionPath({ ad, episode = null, surface = '' }) {
  const key = signingKey();
  const params = new URLSearchParams({ ad: String(ad) });
  if (episode) params.set('episode', String(episode));
  if (surface) params.set('surface', String(surface));
  if (key) {
    const exp = Math.floor(Date.now() / 1000) + IMPRESSION_LIFETIME_SECONDS;
    const nonce = randomBytes(9).toString('base64url');
    params.set('exp', String(exp));
    params.set('n', nonce);
    params.set('sig', mac(key, { ad, episode, surface, exp, nonce }));
  }
  return `/api/house-ads/impression?${params.toString()}`;
}

// { ok, nonce, ttl } for a pixel the server signed and that hasn't
// expired; { ok: false } for anything else. Without any secret configured
// (a local run) nothing can be signed, so nothing is refused either.
export function verifyImpression(query = {}) {
  const key = signingKey();
  if (!key) return { ok: true, nonce: null, ttl: IMPRESSION_LIFETIME_SECONDS };
  const one = (v) => (typeof v === 'string' ? v : '');
  const ad = one(query.ad);
  const episode = one(query.episode);
  const surface = one(query.surface);
  const nonce = one(query.n);
  const sig = one(query.sig);
  const exp = Number(one(query.exp));
  const now = Math.floor(Date.now() / 1000);
  if (!ad || !nonce || !sig || !Number.isFinite(exp) || exp < now || exp > now + IMPRESSION_LIFETIME_SECONDS + 60) return { ok: false };
  const want = Buffer.from(mac(key, { ad, episode, surface, exp, nonce }));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false };
  return { ok: true, nonce, ttl: Math.max(60, exp - now) };
}
