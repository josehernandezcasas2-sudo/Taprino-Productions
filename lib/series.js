import { getSupabase } from './supabase';

// SERVER-ONLY, same rules as lib/publicEpisodes.js — call from
// getServerSideProps, pass results down as props.
//
// Both functions here filter out anything with a pending deletion
// request — this is the "public-safe" series read path (also used for
// the episode-submission series picker, which shouldn't offer a series
// that's about to be removed). The dedicated series-management page and
// my-submissions.js intentionally bypass this and query the table
// directly, since a creator managing their own series/episodes needs to
// see pending-deletion items, not have them silently vanish.

export async function getAllSeries() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('deletion_requested', false);
  if (error) {
    console.error('getAllSeries error:', error.message);
    return [];
  }
  return data.map(rowToSeries);
}

export async function findSeries(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').eq('id', id).eq('deletion_requested', false).maybeSingle();
  if (error || !data) return null;
  return rowToSeries(data);
}

// Unfiltered — includes series with a pending deletion request. Only for
// creator-facing surfaces (the series-management page, my-submissions.js)
// where seeing and acting on those is the whole point; public pages and
// the episode-submission series picker should keep using getAllSeries().
export async function getAllSeriesForCreator() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('series').select('*').order('name', { ascending: true });
  if (error) {
    console.error('getAllSeriesForCreator error:', error.message);
    return [];
  }
  return data.map(rowToSeriesWithDeletionState);
}

function rowToSeriesWithDeletionState(row) {
  return {
    ...rowToSeries(row),
    deletionRequested: row.deletion_requested,
    deletionReason: row.deletion_reason,
    deletionRequestedAt: row.deletion_requested_at,
    pendingPoster: row.pending_poster,
    pendingThumbnail: row.pending_thumbnail,
    pendingTrailerSrc: row.pending_trailer_src,
    pendingHeroImage: row.pending_hero_image,
    pendingName: row.pending_name,
    pendingDescription: row.pending_description
  };
}

function rowToSeries(row) {
  return {
    id: row.id,
    name: row.name,
    desc: row.description,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    poster: row.poster,
    thumbnail: row.thumbnail,
    creatorId: row.creator_id
  };
}
