import { getSupabase } from './supabase';

// SERVER-ONLY, and more specifically: only ever call this from inside
// getServerSideProps, never from a page component's own body — this is the
// one function in the app that can return a real, playable `src`. See
// lib/publicEpisodes.js for the safe subset used everywhere else (rows,
// search, hero carousels) that never includes src at all.
//
// Filters to status = 'approved' — a pending or rejected creator
// submission simply doesn't exist as far as this function is concerned,
// same as a genuinely nonexistent id. That's the entire enforcement point
// of the approval workflow: there's no separate "is this visible yet?"
// check anywhere else in the app, because unapproved content can't be
// found by this function in the first place.
export async function findEpisode(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', id)
    .eq('status', 'approved')
    .maybeSingle();

  if (error || !data) return null;
  return rowToEpisode(data);
}

function rowToEpisode(row) {
  return {
    id: row.id,
    title: row.title,
    desc: row.description,
    tier: row.tier,
    genre: row.genre,
    mainGenre: row.main_genre,
    contentType: row.content_type,
    seriesId: row.series_id,
    season: row.season,
    seriesOrder: row.series_order,
    artist: row.artist,
    runtime: row.runtime,
    type: row.video_type,
    src: row.src,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    featured: row.featured
  };
}
