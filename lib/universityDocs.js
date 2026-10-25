import { getSupabase } from './supabase';

// SERVER-ONLY. Film University files (reading-lesson PDFs, course
// materials, examples) live in their own bucket. Since 2026-10-25 that
// bucket is private (Jose: a creator's teaching material is not for
// anyone who learns a link, nor for a crawler): what a row stores is the
// file's storage address, pages hand out `/api/university/file?lesson=…`
// or `?file=…`, and that route answers with a signed link that lasts an
// hour. Unlike the image uploads (base64 in a JSON body, capped well under
// Vercel's request limit), a course file can run to tens of megabytes, so
// the browser uploads it straight to Supabase Storage with a one-time
// signed upload URL minted here — our server never carries the bytes.
const BUCKET = 'university-docs';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const UNIVERSITY_FILE_ROUTE = '/api/university/file';

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

// The address a page or the app opens: our own route, which signs the
// real file for an hour (pages/api/university/file.js).
export function universityFileHref({ lessonId = null, fileId = null }) {
  if (lessonId) return `${UNIVERSITY_FILE_ROUTE}?lesson=${encodeURIComponent(lessonId)}`;
  if (fileId) return `${UNIVERSITY_FILE_ROUTE}?file=${encodeURIComponent(fileId)}`;
  return null;
}

export function isUniversityFileHref(value) {
  return typeof value === 'string' && value.startsWith(UNIVERSITY_FILE_ROUTE);
}

// The object path inside the bucket, from the address a row stores (a
// Supabase public-style URL; the bucket being private doesn't change it).
// Null for anything else, such as a link an admin typed to a file hosted
// elsewhere.
export function universityStoragePath(url) {
  const m = /\/university-docs\/([^?#]+)/.exec(url || '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

let bucketEnsured = false;

// Creates the bucket private, or makes an existing one private (the
// first version was public, and PDF-only). Returns what it found.
async function ensureBucket(supabase, { force = false } = {}) {
  if (bucketEnsured && !force) return { existed: true, wasPublic: false, changed: false };
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not check storage buckets: ${listError.message}`);
  const existing = (buckets || []).find((b) => b.name === BUCKET);
  let result;
  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(`Could not create storage bucket: ${createError.message}`);
    }
    result = { existed: false, wasPublic: false, changed: true };
  } else if (existing.public || (Array.isArray(existing.allowed_mime_types) && existing.allowed_mime_types.length)) {
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: null });
    if (updateError) throw new Error(`Could not lock the University bucket: ${updateError.message}`);
    result = { existed: true, wasPublic: Boolean(existing.public), changed: true };
  } else {
    result = { existed: true, wasPublic: false, changed: false };
  }
  bucketEnsured = true;
  return result;
}

// The Protection card's button (pages/api/admin/protect-media.js): make
// the bucket private now, whether or not anything has been uploaded
// since the deploy.
export async function lockUniversityBucket() {
  return ensureBucket(getSupabase(), { force: true });
}

// A link that opens the stored file for an hour. `download` asks the
// browser to save it rather than show it. A stored value that isn't in
// our bucket (a link to a file hosted elsewhere) comes back as it is.
export async function signedUniversityUrl(storedUrl, { download = false, expiresInSeconds = 3600 } = {}) {
  const path = universityStoragePath(storedUrl);
  if (!path) return /^https?:\/\//.test(storedUrl || '') ? storedUrl : null;
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds, download ? { download: true } : undefined);
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
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
// file to uploadUrl; once that succeeds, `publicUrl` is the address to
// store on the row (the bucket's path-style URL; it only opens through
// the signing route now, the name is kept for the editor). The upload URL
// is good for two hours, one path only.
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
