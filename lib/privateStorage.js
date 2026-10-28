import { getSupabase } from './supabase';
import { internalError } from './apiErrors';

// SERVER-ONLY. One private Supabase Storage bucket for files that must
// never sit at a permanent public URL (Jose, 2026-10-25: a creator's work
// and people's paperwork are not for anyone who learns a link, and not
// for AI crawlers): location ownership proofs, caption tracks, and
// whatever comes next. What a row stores is a reference, `private:<path>`,
// never a URL; a reader who is allowed to see the file gets a signed link
// that lasts an hour, or the bytes through one of our own routes.
export const PRIVATE_BUCKET = 'private-uploads';
export const PRIVATE_PREFIX = 'private:';
const MAX_BYTES = 6 * 1024 * 1024;

let ensured = false;

export async function ensurePrivateBucket(supabase = getSupabase()) {
  if (ensured) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw internalError(listError, 'Could not check storage buckets');
  if (!(buckets || []).some((b) => b.name === PRIVATE_BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw internalError(createError, 'Could not create the private bucket');
    }
  }
  ensured = true;
}

export function isPrivateRef(value) {
  return typeof value === 'string' && value.startsWith(PRIVATE_PREFIX) && value.length > PRIVATE_PREFIX.length + 3;
}

export function privatePath(ref) {
  return isPrivateRef(ref) ? ref.slice(PRIVATE_PREFIX.length) : null;
}

// Stores bytes at `path` and returns the reference to keep on the row.
export async function uploadPrivate({ path, buffer, contentType }) {
  const supabase = getSupabase();
  await ensurePrivateBucket(supabase);
  const { error } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw internalError(error, 'Could not store the file');
  return `${PRIVATE_PREFIX}${path}`;
}

// A link that works for `expiresInSeconds`. A plain http(s) value (a file
// stored before the private bucket existed) comes back as it is; anything
// else unreadable becomes null rather than a broken link.
export async function signPrivate(ref, { expiresInSeconds = 3600 } = {}) {
  if (!ref) return null;
  if (!isPrivateRef(ref)) return /^https?:\/\//.test(ref) ? ref : null;
  const { data, error } = await getSupabase().storage.from(PRIVATE_BUCKET).createSignedUrl(privatePath(ref), expiresInSeconds);
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
}

// The bytes, for a route that serves the file itself (small files only:
// a caption track, not a feature). Null when missing.
export async function downloadPrivate(ref) {
  const path = privatePath(ref);
  if (!path) return null;
  const { data, error } = await getSupabase().storage.from(PRIVATE_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function removePrivate(ref) {
  const path = privatePath(ref);
  if (!path) return false;
  const { error } = await getSupabase().storage.from(PRIVATE_BUCKET).remove([path]);
  return !error;
}
