import { getSupabase } from './supabase';

// Returns { GenreName: imageUrl } for every genre that has an admin-uploaded
// override. Genres not present here should fall back to the built-in emoji
// map in components/GenreBrowseRow.js — that fallback lives client-side so
// a genre never renders as empty just because this table has no row for it
// yet (which is the normal, expected state for most genres, most of the
// time).
export async function getGenreIcons() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('genre_icons').select('genre, image_url');
  if (error) {
    console.error('getGenreIcons error:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.genre, row.image_url]));
}
