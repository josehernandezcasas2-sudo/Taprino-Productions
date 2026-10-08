import { getSupabase } from './supabase';
import { uploadArtworkImage } from './artworkUpload';
import { STANDARD_RATINGS } from './contentRatings';

// The live list of content ratings (migration 075): the standard ones plus
// any custom rating an admin added on /admin/ratings, each with the
// minimum viewer age the age gate uses and the PNG bug the channel player
// shows. Read often (every age check, every player), so it's cached for a
// minute; writes clear the cache.

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 +\-]{0,15}$/;
let cache = { at: 0, list: null };

function toPublic(row) {
  return { code: row.code, label: row.label, minAge: row.min_age, imageUrl: row.image_url || null, custom: !!row.is_custom, sort: row.sort };
}

export async function getRatings({ fresh = false } = {}) {
  if (!fresh && cache.list && Date.now() - cache.at < 60000) return cache.list;
  let list;
  try {
    const { data, error } = await getSupabase().from('content_ratings').select('code, label, min_age, image_url, sort, is_custom').order('sort', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) throw new Error('no ratings yet');
    list = data.map(toPublic);
  } catch (err) {
    // Before migration 075 (or an empty table): the built-in list.
    list = STANDARD_RATINGS.map((r, i) => ({ ...r, imageUrl: null, custom: false, sort: (i + 1) * 10 }));
  }
  cache = { at: Date.now(), list };
  return list;
}

export function invalidateRatings() {
  cache = { at: 0, list: null };
}

function fail(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

// Adds a custom rating, or updates a rating's label / minimum age / image.
// Standard ratings keep their code, label and minimum age; only their
// image changes. Returns the saved rating.
export async function saveRating({ code, label, minAge, imageBase64, imageFileName, clearImage }) {
  const c = String(code || '').trim();
  if (!CODE_RE.test(c)) fail('A rating code is 1–16 letters, digits, spaces, + or -.');
  const supabase = getSupabase();
  const { data: existing, error: exErr } = await supabase.from('content_ratings').select('code, label, min_age, image_url, sort, is_custom').eq('code', c).maybeSingle();
  if (exErr) throw new Error(/content_ratings/.test(exErr.message) ? 'Run migration 075 (content_ratings) first.' : exErr.message);
  const standard = STANDARD_RATINGS.find((r) => r.code.toLowerCase() === c.toLowerCase());
  const row = existing
    ? { ...existing }
    : { code: c, label: '', min_age: 17, image_url: null, sort: 1000, is_custom: !standard };
  if (standard && !existing) { row.label = standard.label; row.min_age = standard.minAge; row.sort = STANDARD_RATINGS.indexOf(standard) * 10 + 10; }
  if (row.is_custom) {
    if (label !== undefined) row.label = String(label || '').trim().slice(0, 60) || row.label || c;
    if (minAge !== undefined) {
      const n = Math.round(Number(minAge));
      if (!Number.isFinite(n) || n < 0 || n > 21) fail('Minimum age has to be between 0 and 21.');
      row.min_age = n;
    }
    if (!row.label) row.label = c;
  }
  if (clearImage) row.image_url = null;
  if (imageBase64) {
    const url = await uploadArtworkImage({ base64: imageBase64, fileName: imageFileName, pathPrefix: `rating-${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` });
    if (!url) fail('Could not process that image.');
    row.image_url = url;
  }
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('content_ratings').upsert(row, { onConflict: 'code' });
  if (error) throw new Error(error.message);
  invalidateRatings();
  return toPublic(row);
}

// Only custom ratings can be removed; the standard list stays.
export async function deleteRating(code) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('content_ratings').select('code, is_custom').eq('code', code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('No such rating.');
  if (!data.is_custom) fail('The standard ratings stay; you can only remove custom ones.');
  const { error: delErr } = await supabase.from('content_ratings').delete().eq('code', code);
  if (delErr) throw new Error(delErr.message);
  invalidateRatings();
}
