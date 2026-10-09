import { getSupabase } from './supabase';

// SERVER-ONLY. Film University documents (PDF lessons, templates,
// worksheets) live in their own public bucket: they're free downloads by
// design, like episode artwork, so there's nothing to sign. Unlike the
// image uploads (base64 in a JSON body, capped well under Vercel's request
// limit), a PDF can run to tens of megabytes, so the browser uploads it
// straight to Supabase Storage with a one-time signed upload URL minted
// here — our server never carries the bytes.
const BUCKET = 'university-docs';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB — a long script PDF with images

let bucketEnsured = false;

async function ensureBucket(supabase) {
  if (bucketEnsured) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  if (!(buckets || []).some((b) => b.name === BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ['application/pdf']
    });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
  }
  bucketEnsured = true;
}

function safeBaseName(name) {
  const base = String(name || 'document')
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'document';
}

// Returns { uploadUrl, publicUrl, path }. The browser PUTs the file body to
// uploadUrl (Content-Type: application/pdf); once that succeeds, publicUrl
// is the permanent address to store on the lesson. The upload URL is good
// for two hours and for that one path only.
export async function createDocumentUploadUrl({ fileName, fileSize }) {
  if (!fileSize || fileSize <= 0) throw new Error('fileSize is required.');
  if (fileSize > MAX_BYTES) throw new Error('That PDF is over 50MB — please compress it first.');
  if (!/\.pdf$/i.test(fileName || '')) throw new Error('Only PDF documents are supported right now.');

  const supabase = getSupabase();
  await ensureBucket(supabase);

  const path = `${safeBaseName(fileName)}-${Date.now().toString(36)}.pdf`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Could not create an upload link: ${error.message}`);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { uploadUrl: data.signedUrl, token: data.token, path, publicUrl: pub.publicUrl };
}
