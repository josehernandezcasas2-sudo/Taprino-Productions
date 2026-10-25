import { randomBytes } from 'node:crypto';
import { getSupabase } from './supabase';

// SERVER-ONLY — called from pages/api/creator/submit-episode.js.
//
// Separate bucket from anything video-related on purpose: posters and
// thumbnails are small, public-by-design images (they're meant to be seen
// everywhere on the site), unlike the actual episode video which stays
// behind Cloudflare Stream and this app's own entitlement checks. There's
// no privacy reason to keep artwork off a public bucket.
const BUCKET = 'episode-art';
const MAX_BYTES = 6 * 1024 * 1024; // 6MB — plenty for a compressed poster/thumbnail JPEG/PNG

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
    // A race where two requests both try to create it at once is the only
    // expected error here — anything else should surface.
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
  }
  bucketEnsured = true;
}

// What the bytes actually are, whatever the file was called: JPEG, PNG,
// WebP or GIF. Anything else (SVG above all, which can carry script and
// would be served from this public bucket) is refused.
function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  return null;
}

// `base64` is a data URL (data:image/jpeg;base64,....) from the browser's
// FileReader — bare base64 is tolerated too. `pathPrefix` should already
// be unique per submission (e.g. the episode id) so a poster and a
// thumbnail for the same episode never collide. Returns null (not an
// error) when no image was provided at all, since both fields are
// optional — the caller just skips setting that column.
export async function uploadArtworkImage({ base64, fileName, pathPrefix, allowSvg = false }) {
  if (!base64) return null;

  const commaIndex = base64.indexOf(',');
  const raw = base64.startsWith('data:') && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
  const buffer = Buffer.from(raw, 'base64');

  if (buffer.length === 0) return null;
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Image "${fileName || 'file'}" is too large — please use a file under 6MB.`);
  }

  const supabase = getSupabase();
  await ensureBucket(supabase);

  // SVG only where an admin is the uploader (channel logos, icon sets).
  const svg = allowSvg && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buffer.toString('utf8', 0, 2048));
  const kind = sniffImage(buffer) || (svg ? { ext: 'svg', type: 'image/svg+xml' } : null);
  if (!kind) throw new Error(`"${fileName || 'That file'}" isn't a JPEG, PNG, WebP or GIF image.`);
  // A random part, not a timestamp: the bucket is public, so a path
  // someone could guess (a host's ownership proof, say) shouldn't exist.
  const path = `${pathPrefix}-${randomBytes(9).toString('hex')}.${kind.ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: kind.type,
    upsert: true
  });
  if (error) throw new Error(`Could not upload "${fileName || 'image'}": ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/* ===================================================================
   Private images (Jose, 2026-10-25)
   ===================================================================
   A host's ownership proof (a lease, a deed, an ID) is not artwork: it
   used to sit in the public bucket, reachable by anyone who learnt the
   URL. These go to a bucket with no public access; what is stored on the
   row is a reference, `private:<path>`, and a reader who is allowed to
   see it (the host, an admin) gets a signed URL that lasts an hour.
   =================================================================== */
const PRIVATE_BUCKET = 'private-uploads';
const PRIVATE_PREFIX = 'private:';
let privateBucketEnsured = false;

async function ensurePrivateBucket(supabase) {
  if (privateBucketEnsured) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  if (!(buckets || []).some((b) => b.name === PRIVATE_BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create the private bucket: ${createError.message}`);
    }
  }
  privateBucketEnsured = true;
}

export function isPrivateImageRef(value) {
  return typeof value === 'string' && value.startsWith(PRIVATE_PREFIX) && value.length > PRIVATE_PREFIX.length + 3;
}

// Same input as uploadArtworkImage; returns the `private:<path>` reference
// to store, never a URL.
export async function uploadPrivateImage({ base64, fileName, pathPrefix }) {
  if (!base64) return null;
  const commaIndex = base64.indexOf(',');
  const raw = base64.startsWith('data:') && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length === 0) return null;
  if (buffer.length > MAX_BYTES) throw new Error(`Image "${fileName || 'file'}" is too large — please use a file under 6MB.`);
  const kind = sniffImage(buffer);
  if (!kind) throw new Error(`"${fileName || 'That file'}" isn't a JPEG, PNG, WebP or GIF image.`);
  const supabase = getSupabase();
  await ensurePrivateBucket(supabase);
  const path = `${pathPrefix}-${randomBytes(9).toString('hex')}.${kind.ext}`;
  const { error } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, buffer, { contentType: kind.type, upsert: true });
  if (error) throw new Error(`Could not upload "${fileName || 'image'}": ${error.message}`);
  return `${PRIVATE_PREFIX}${path}`;
}

// A URL the caller may hand to someone entitled to see the file. A plain
// http(s) value (a proof uploaded before the private bucket existed) is
// returned as it is; anything unreadable becomes null rather than a
// broken link.
export async function signedPrivateImageUrl(ref, { expiresInSeconds = 3600 } = {}) {
  if (!ref) return null;
  if (!isPrivateImageRef(ref)) return /^https?:\/\//.test(ref) ? ref : null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(ref.slice(PRIVATE_PREFIX.length), expiresInSeconds);
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
}
