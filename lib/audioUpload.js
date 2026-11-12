import { getSupabase } from './supabase';
import { safeFetch } from './safeFetch';

// UNLIKE video imports (which hand the URL to Cloudflare's own servers to
// fetch — see import-video-url.js), there's no Cloudflare-equivalent
// ingest service for audio. THIS SERVER does the fetching here, which
// makes the URL validation in lib/urlValidation.js a genuine SSRF
// safeguard for our own infrastructure, not just a UX nicety. Treat any
// change to that validation, or to this function, as security-sensitive.
const BUCKET = 'episode-audio';
const MAX_BYTES = 150 * 1024 * 1024; // 150MB — generous for a compressed long-form episode, bounded enough to keep a serverless function's fetch+buffer+upload within reasonable memory/time.
const ALLOWED_CONTENT_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm'];
const FETCH_TIMEOUT_MS = 45000;
const BODY_TIMEOUT_MS = 240000;

let bucketEnsured = false;

// The bucket is made private (Jose, 2026-11-12): what a row stores is the
// file's storage address, and every play goes through
// /api/podcasts/audio/<id>, which hands out a link that lasts a few hours
// (lib/podcastAudio.js). An existing public bucket is left as it is here
// (it was public until then); Admin → AI security → "Lock podcast audio"
// flips it, through lockPodcastAudioBucket below. Nothing is copied: the
// files stay where they are and only stop opening at a public address.
async function ensureBucket(supabase, { lock = false } = {}) {
  if (bucketEnsured && !lock) return { existed: true, wasPublic: false, changed: false };
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  const existing = (buckets || []).find((b) => b.name === BUCKET);
  let result = { existed: Boolean(existing), wasPublic: Boolean(existing && existing.public), changed: false };
  let current = existing;
  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES
    });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
    if (!createError) {
      bucketEnsured = true;
      return { existed: false, wasPublic: false, changed: true };
    }
    // Another instance made it a moment ago: read what it made.
    const { data: made, error: getError } = await supabase.storage.getBucket(BUCKET);
    if (getError || !made) throw new Error(`Could not check storage buckets: ${getError ? getError.message : 'not found'}`);
    current = made;
    result = { existed: true, wasPublic: Boolean(made.public), changed: false };
  }
  if (lock && current.public) {
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (updateError) throw new Error(`Could not lock the podcast audio bucket: ${updateError.message}`);
    result = { existed: true, wasPublic: true, changed: true };
  }
  bucketEnsured = true;
  return result;
}

// Admin → AI security's "Lock podcast audio" (pages/api/admin/protect-media.js,
// what: 'podcasts'): make the bucket private now. Safe to press again.
// Returns { existed, wasPublic, changed }.
export async function lockPodcastAudioBucket() {
  return ensureBucket(getSupabase(), { lock: true });
}

function extensionFromContentType(contentType) {
  const map = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba'
  };
  return map[contentType] || 'mp3';
}

// Fetches a validated, already-checked URL (call validateRemoteVideoUrl
// first — its checks are generic URL/SSRF validation despite the name)
// and re-hosts the file on our own storage. Never trusts the remote
// server's declared Content-Length for anything beyond a fast-path
// rejection — the real enforcement is the byte counter while streaming.
export async function importAudioFromUrl(url, fileName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    // safeFetch: every hop must resolve to a public address.
    response = await safeFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StudioTapaAudioImport/1.0' }
    });
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(err.name === 'AbortError' ? 'That link took too long to respond.' : `Could not reach that link: ${err.message}`);
  }
  // The download itself gets its own, longer clock (security round,
  // 2026-10-26): until then a body sent a trickle at a time was never
  // cut off at all.
  clearTimeout(timeout);
  const bodyTimeout = setTimeout(() => controller.abort(), BODY_TIMEOUT_MS);
  try {
    return await storeAudioResponse(response);
  } catch (err) {
    if (controller.signal.aborted) throw new Error('That link took too long to send the file.');
    throw err;
  } finally {
    clearTimeout(bodyTimeout);
  }
}

async function storeAudioResponse(response) {
  if (!response.ok) {
    throw new Error(`That link returned an error (${response.status}) — check it's a direct, public download link.`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`That link doesn't look like an audio file (got "${contentType || 'unknown'}"). Use a direct .mp3/.m4a/.wav link.`);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) {
    throw new Error(`That file is too large — audio episodes are capped at ${Math.round(MAX_BYTES / (1024 * 1024))}MB.`);
  }

  // Buffer with a hard byte-count cap regardless of what Content-Length
  // claimed — a server could lie about its own header.
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      throw new Error(`That file is too large — audio episodes are capped at ${Math.round(MAX_BYTES / (1024 * 1024))}MB.`);
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  if (buffer.length === 0) {
    throw new Error('That link returned an empty file.');
  }

  const supabase = getSupabase();
  await ensureBucket(supabase);

  const ext = extensionFromContentType(contentType);
  const path = `podcast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: true
  });
  if (error) throw new Error(`Could not save the audio file: ${error.message}`);

  // The bucket's path-style address is what the row stores. Once the
  // bucket is private it opens only through the route, which signs it.
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, sizeBytes: buffer.length };
}
