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
    .eq('deletion_requested', false)
    .maybeSingle();

  if (error || !data) return null;

  // Same series-level artwork fallback as getPublicEpisodes.js — only
  // worth the extra query when this episode actually needs it (belongs to
  // a series AND is missing its own poster or thumbnail).
  let seriesArt = null;
  if (data.series_id && (!data.poster || !data.thumbnail)) {
    const { data: seriesRow } = await supabase.from('series').select('poster, thumbnail').eq('id', data.series_id).maybeSingle();
    seriesArt = seriesRow;
  }

  return rowToEpisode(data, seriesArt);
}

function rowToEpisode(row, seriesArt) {
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
    audioUrl: row.audio_url,
    trailerSrc: row.trailer_src,
    heroImage: row.hero_image,
    poster: row.poster || (seriesArt ? seriesArt.poster : null),
    thumbnail: row.thumbnail || (seriesArt ? seriesArt.thumbnail : null),
    featured: row.featured,
    // Needed so a view can be bucketed against the creator who made it.
    submittedBy: row.submitted_by,
    captionsUrl: row.captions_url || null,
    captionsLanguage: row.captions_language || 'en',
    captionsLabel: row.captions_label || 'English',
    audioDescriptionSrc: row.audio_description_src || null,
    accessibilityNotes: row.accessibility_notes || null,
    hasFlashingLights: !!row.has_flashing_lights,
    transcriptUrl: row.transcript_url || null
  };
}
