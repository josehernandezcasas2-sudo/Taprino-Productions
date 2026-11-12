import { getSupabase } from './supabase';
import { AUDIO_BUCKET, AUDIO_LINK_SECONDS, audioExtensionOf, audioStoragePath, isExternalAudio, podcastAudioPath } from './podcastAudioRules';
import { mintAudioKey, verifyAudioKey } from './podcastAudioKeys';

// SERVER-ONLY. Podcast audio behind the route (lib/podcastAudioRules.js
// says how it fits together; Jose, 2026-11-12). The keys on the route's
// addresses are lib/podcastAudioKeys.js.
export { mintAudioKey, verifyAudioKey };

// What a page or the app plays: the route with a key minted for `mode`,
// or the bare route when nothing can be signed. Null without audio.
export function playableAudioUrl(id, storedAudioUrl, mode = 'v') {
  if (!storedAudioUrl) return null;
  return podcastAudioPath(id, { ext: audioExtensionOf(storedAudioUrl), key: mintAudioKey(id, mode) });
}

// The bare route (no key) for an episode with audio: what the episode
// page carries, and what RSS enclosures point at (with the site's origin).
export function audioRoutePath(id, storedAudioUrl) {
  if (!storedAudioUrl) return null;
  return podcastAudioPath(id, { ext: audioExtensionOf(storedAudioUrl) });
}

// Where a play actually goes: a signed link to our bucket that lasts
// AUDIO_LINK_SECONDS, the stored address itself for audio hosted
// elsewhere (https only), or null when neither works.
export async function audioLinkFor(storedAudioUrl, { expiresInSeconds = AUDIO_LINK_SECONDS } = {}) {
  const path = audioStoragePath(storedAudioUrl, process.env.SUPABASE_URL);
  if (!path) return isExternalAudio(storedAudioUrl) ? String(storedAudioUrl).trim() : null;
  const { data, error } = await getSupabase().storage.from(AUDIO_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data || !data.signedUrl) {
    if (error) console.error('podcastAudio sign:', error.message);
    return null;
  }
  return data.signedUrl;
}

// The stored file's size, for an RSS enclosure on an episode imported
// before audio_bytes existed (migration 052): a HEAD on a short signed
// link to our own storage (lib/podcastRss.js asks a link someone typed
// itself, through safeFetch). 0 when it can't be read.
export async function storedAudioBytes(storedAudioUrl) {
  if (!audioStoragePath(storedAudioUrl, process.env.SUPABASE_URL)) return 0;
  try {
    const link = await audioLinkFor(storedAudioUrl, { expiresInSeconds: 120 });
    if (!link) return 0;
    const res = await fetch(link, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const len = Number(res.headers.get('content-length') || 0);
    return res.ok && len > 0 ? len : 0;
  } catch (err) {
    return 0;
  }
}
