import { getSupabase } from './supabase';

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

let bucketEnsured = false;

async function ensureBucket(supabase) {
  if (bucketEnsured) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  const exists = (buckets || []).some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES
    });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
  }
  bucketEnsured = true;
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
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'StudioTapaAudioImport/1.0' }
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'That link took too long to respond.' : `Could not reach that link: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

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

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, sizeBytes: buffer.length };
}
