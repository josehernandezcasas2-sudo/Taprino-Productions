import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, freshToken } from './api';

// Trailers play through signed links like the films (decision 12 of the
// series revamp; the website's components/HeroSpotlight.js): the server
// signs each for 60 minutes and hands over `trailerExpiresAt` (unix
// seconds) and `trailerRef` ({ episodeId } | { seriesId }) with it. A hero
// or an episode screen left open past the hour played a black frame; this
// asks /api/stream-token (part 'trailer') for a fresh link when the one in
// hand has run out or fails, at most once per trailer per five minutes, and
// says `failed` when there is none to be had — the hero then shows its
// artwork, the episode screen goes back to the title.
const RETRY_GAP_MS = 5 * 60 * 1000;

export function trailerKeyOf(ref) {
  if (!ref) return null;
  if (ref.seriesId) return `s:${ref.seriesId}`;
  if (ref.episodeId) return `e:${ref.episodeId}`;
  return null;
}

// Gone or about to go (a minute's margin); null never expires.
export function trailerExpired(expiresAt, now = Date.now()) {
  return Boolean(expiresAt) && Number(expiresAt) * 1000 < now + 60 * 1000;
}

// → { src, expiresAt } | null
export async function fetchTrailerSrc(ref, getToken) {
  const body = ref && ref.seriesId
    ? { seriesId: ref.seriesId, part: 'trailer' }
    : ref && ref.episodeId ? { episodeId: ref.episodeId, part: 'trailer' } : null;
  if (!body) return null;
  try {
    const token = getToken ? await freshToken(getToken) : null;
    const data = await apiPost('/api/stream-token', body, token);
    return data && data.src ? { src: data.src, expiresAt: data.expiresAt || null } : null;
  } catch {
    return null;
  }
}

// Per trailer for the app's session, so a rotating hero remembers what it
// already fetched or found broken. A new link from the page (a fresh feed)
// starts the trailer over.
const memory = new Map();
function entryFor(key, src, expiresAt) {
  let e = memory.get(key);
  if (!e || (src && e.pageSrc !== src)) {
    e = { pageSrc: src, src, expiresAt, broken: !src, asking: false, askedAt: 0 };
    memory.set(key, e);
  }
  return e;
}

// `wanted`: the trailer is (about to be) on screen — only then is a fresh
// link asked for. → { src, failed, onError }: `src` is null while a fresh
// one is on its way and once it has failed.
export function useTrailerLink({ src = null, expiresAt = null, ref = null, wanted = false, getToken = null }) {
  const key = src ? trailerKeyOf(ref) || `src:${src}` : null;
  const [, bump] = useState(0);
  const refRef = useRef(ref);
  refRef.current = ref;
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const entry = key ? entryFor(key, src, expiresAt) : null;

  const refresh = useCallback(() => {
    const e = key ? memory.get(key) : null;
    if (!e || e.asking || e.broken) return;
    const r = refRef.current;
    if (!trailerKeyOf(r) || Date.now() - e.askedAt < RETRY_GAP_MS) {
      e.broken = true;
      bump((n) => n + 1);
      return;
    }
    e.asking = true;
    e.askedAt = Date.now();
    bump((n) => n + 1);
    fetchTrailerSrc(r, tokenRef.current).then((fresh) => {
      e.asking = false;
      if (fresh) { e.src = fresh.src; e.expiresAt = fresh.expiresAt; } else e.broken = true;
      bump((n) => n + 1);
    });
  }, [key]);

  const expired = Boolean(entry && trailerExpired(entry.expiresAt));
  useEffect(() => {
    if (wanted && expired) refresh();
  }, [wanted, expired, refresh]);

  if (!entry) return { src: null, failed: false, onError: refresh };
  return { src: !entry.broken && !entry.asking && !expired ? entry.src : null, failed: entry.broken, onError: refresh };
}
