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

function extensionFromFileName(name) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  const ext = match ? match[1].toLowerCase() : 'jpg';
  return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
}

function contentTypeForExtension(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

// `base64` is a data URL (data:image/jpeg;base64,....) from the browser's
// FileReader — bare base64 is tolerated too. `pathPrefix` should already
// be unique per submission (e.g. the episode id) so a poster and a
// thumbnail for the same episode never collide. Returns null (not an
// error) when no image was provided at all, since both fields are
// optional — the caller just skips setting that column.
export async function uploadArtworkImage({ base64, fileName, pathPrefix }) {
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

  const ext = extensionFromFileName(fileName);
  const path = `${pathPrefix}-${Date.now().toString(36)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: contentTypeForExtension(ext),
    upsert: true
  });
  if (error) throw new Error(`Could not upload "${fileName || 'image'}": ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
