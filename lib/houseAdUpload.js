import { getSupabase } from './supabase';

// SERVER-ONLY.
//
// Deliberately NOT routed through Cloudflare Stream, unlike episode video.
// Three reasons: (1) a house ad has no piracy concern — it's your own
// promotional clip, meant to play freely, so none of the signed-URL
// machinery applies; (2) VAST's <MediaFile> wants a direct, progressive
// file the ad player can just play, not an adaptive HLS manifest, and
// getting a plain MP4 out of Cloudflare Stream means enabling "downloads"
// per video and polling for it to finish — real complexity for something
// that doesn't need Stream's actual strengths; (3) storing it as a small
// file we upload inline keeps this shippable as one self-contained system
// rather than a second integration with a second async job to track.
//
// The trade-off that comes with skipping Cloudflare Stream: no resumable
// upload, so the size cap has to stay well under what a serverless
// function's request body can carry as a single base64 payload. That's why
// this is capped tighter than a real episode — see MAX_BYTES below.
const BUCKET = 'house-ads';
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — a compressed 10-20s promo at 720p fits comfortably

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

function extensionFromFileName(name) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  const ext = match ? match[1].toLowerCase() : 'mp4';
  return ['mp4', 'mov', 'webm'].includes(ext) ? ext : 'mp4';
}

function contentTypeForExtension(ext) {
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  return 'video/mp4';
}

export async function uploadHouseAdVideo({ base64, fileName }) {
  if (!base64) throw new Error('No video file was provided.');

  const commaIndex = base64.indexOf(',');
  const raw = base64.startsWith('data:') && commaIndex !== -1 ? base64.slice(commaIndex + 1) : base64;
  const buffer = Buffer.from(raw, 'base64');

  if (buffer.length === 0) throw new Error('That file is empty.');
  if (buffer.length > MAX_BYTES) {
    throw new Error(
      `That file is ${(buffer.length / (1024 * 1024)).toFixed(1)}MB — house ad clips need to be under ${MAX_BYTES / (1024 * 1024)}MB. Try compressing it, or trimming it shorter.`
    );
  }

  const supabase = getSupabase();
  await ensureBucket(supabase);

  const ext = extensionFromFileName(fileName);
  const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: contentTypeForExtension(ext),
    upsert: false
  });
  if (error) throw new Error(`Could not upload the video: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, bytes: buffer.length };
}
