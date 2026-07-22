import { getSupabase } from './supabase';

// SERVER-ONLY. Call this from inside getServerSideProps and pass the result
// down as a prop — never import this module directly into a page component.
//
// Two layers of protection against the real video file ever reaching a
// browser that shouldn't have it, same principle as before this became a
// database-backed query:
//   1. The SELECT below never asks for the `src` column at all — it's not
//      just omitted after the fact, it's structurally impossible for this
//      function to return it, since the database never sends it.
//   2. `.eq('status', 'approved')` — pending or rejected creator
//      submissions are invisible here regardless of anything else, which is
//      the entire point of the approval workflow.
export async function getPublicEpisodes() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, description, tier, genre, main_genre, content_type, series_id, season, series_order, artist, runtime, video_type, trailer_src, hero_image, featured')
    .eq('status', 'approved');

  if (error) {
    console.error('getPublicEpisodes error:', error.message);
    return [];
  }

  return data.map(rowToPublicEpisode);
}

export async function findPublicEpisode(id) {
  const episodes = await getPublicEpisodes();
  return episodes.find((e) => e.id === id) || null;
}

// Maps the database's snake_case columns back to the camelCase field names
// every page and component in this app already expects — keeps this the
// only place that needs to know the database's naming, not every caller.
function rowToPublicEpisode(row) {
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
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    featured: row.featured
  };
}
