import { getSupabase } from './supabase';

// Best-effort by design: recording an orphan is bookkeeping, not the
// actual operation the caller is performing (deleting an episode,
// replacing a video, etc.). If this insert fails, the real operation
// should still proceed — losing a bookkeeping row is a minor annoyance;
// blocking a deletion or a video replacement because of it would not be.
export async function recordOrphan({ kind, reference, reason, context }) {
  if (!reference) return;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('orphaned_media').insert({ kind, reference, reason, context: context || null });
    if (error) console.error('recordOrphan error:', error.message);
  } catch (err) {
    console.error('recordOrphan error:', err.message);
  }
}

// Extracts the storage path this app itself generated in
// lib/artworkUpload.js from a Supabase Storage public URL — the part
// after ".../object/public/episode-art/". Returns null for anything else
// (e.g. a URL from a different bucket, or not a Supabase Storage URL at
// all), since that shouldn't be treated as something this app can clean up.
export function storagePathFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/episode-art\/([^?]+)/);
  return match ? match[1] : null;
}

// Is a stored image (its episode-art path) still on a title? A file can be
// listed as orphaned while something else still shows it: an accepted
// application gives a show and its first episode the same poster, so one
// of them being deleted or re-arted lists the other's picture. Looked up
// right before Delete in Orphaned media (pages/api/admin/cleanup-orphan.js),
// like videoInUse for videos. Any doubt — an unreadable column, a path with
// a LIKE wildcard in it — counts as in use (the file stays).
const IMAGE_COLUMNS = {
  episodes: ['poster', 'thumbnail', 'pending_poster', 'pending_thumbnail', 'title_image_url', 'pending_title_image_url', 'hero_image'],
  series: ['poster', 'thumbnail', 'hero_image', 'title_image_url', 'pending_poster', 'pending_thumbnail', 'pending_hero_image', 'pending_title_image_url']
};
const isMissingColumn = (error) => Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));

export async function imageInUse(path) {
  const ref = String(path || '');
  if (!ref) return false;
  if (/[%\\]/.test(ref)) return true;
  const supabase = getSupabase();
  // "_" is a one-character wildcard in LIKE: left as it is, it can only
  // match more, never less.
  const pattern = `%/episode-art/${ref}%`;
  for (const [table, columns] of Object.entries(IMAGE_COLUMNS)) {
    for (const col of columns) {
      const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).ilike(col, pattern);
      if (error) {
        if (isMissingColumn(error)) continue;
        return true;
      }
      if ((count || 0) > 0) return true;
    }
  }
  return false;
}
