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
