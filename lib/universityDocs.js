import { getSupabase } from './supabase';

// SERVER-ONLY. Film University files (reading-lesson PDFs, course
// materials, examples) live in their own public bucket: they're free
// downloads by design, like episode artwork, so there's nothing to sign.
// Unlike the image uploads (base64 in a JSON body, capped well under
// Vercel's request limit), a course file can run to tens of megabytes, so
// the browser uploads it straight to Supabase Storage with a one-time
// signed upload URL minted here — our server never carries the bytes.
const BUCKET = 'university-docs';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

// What a course file can be. Keyed by extension; the value is the short
// label the UI puts on the file icon. Anything else is refused up front.
export const FILE_TYPES = {
  pdf: 'pdf',
  xlsx: 'xlsx', xls: 'xlsx', csv: 'csv', numbers: 'xlsx',
  docx: 'docx', doc: 'docx', pages: 'docx', rtf: 'docx', txt: 'txt', md: 'txt',
  fdx: 'fdx', fountain: 'fdx', celtx: 'fdx',
  pptx: 'pptx', key: 'pptx',
  zip: 'zip',
  png: 'img', jpg: 'img', jpeg: 'img', webp: 'img',
  cube: 'lut', '3dl': 'lut',
  mp3: 'audio', wav: 'audio', aif: 'audio', aiff: 'audio',
  prproj: 'project', drp: 'project', fcpxml: 'project', xml: 'project'
};

export function fileTypeFor(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || '');
  const ext = m ? m[1].toLowerCase() : '';
  return FILE_TYPES[ext] || null;
}

let bucketEnsured = false;

async function ensureBucket(supabase) {
  if (bucketEnsured) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  const existing = (buckets || []).find((b) => b.name === BUCKET);
  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
  } else if (Array.isArray(existing.allowed_mime_types) && existing.allowed_mime_types.length) {
    // The first version of this bucket was PDF-only; lift that so
    // spreadsheets, scripts and zips can go in too.
    await supabase.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: null });
  }
  bucketEnsured = true;
}

function safeBaseName(name) {
  const base = String(name || 'file')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'file';
}

// Returns { uploadUrl, publicUrl, path, fileType }. The browser PUTs the
// file to uploadUrl; once that succeeds, publicUrl is the permanent
// address to store. The upload URL is good for two hours, one path only.
export async function createDocumentUploadUrl({ fileName, fileSize }) {
  if (!fileSize || fileSize <= 0) throw new Error('fileSize is required.');
  if (fileSize > MAX_BYTES) throw new Error('That file is over 50MB — please compress it or split it.');
  const fileType = fileTypeFor(fileName);
  if (!fileType) throw new Error(`That file type isn't supported. Use ${Object.keys(FILE_TYPES).slice(0, 12).join(', ')}…`);

  const supabase = getSupabase();
  await ensureBucket(supabase);

  const ext = /\.([a-z0-9]+)$/i.exec(fileName)[1].toLowerCase();
  const path = `${safeBaseName(fileName)}-${Date.now().toString(36)}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Could not create an upload link: ${error.message}`);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { uploadUrl: data.signedUrl, token: data.token, path, publicUrl: pub.publicUrl, fileType };
}
