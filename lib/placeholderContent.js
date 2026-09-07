import { getSupabase } from './supabase';

// A simple labeled color block as a data URI — no Supabase Storage upload
// needed, no dependency on an external test-asset URL whose reliability
// or licensing can't be fully verified. Just enough for a card, hero, or
// episode page to render something recognizable instead of a broken
// image icon, which is all "see how it looks" actually needs.
function svgThumbnail(label, sublabel, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="${color}"/>
    <rect width="640" height="360" fill="#000" opacity="0.15"/>
    <text x="320" y="175" font-family="Georgia, serif" font-size="34" font-weight="bold" fill="#f4ecda" text-anchor="middle">${label}</text>
    <text x="320" y="205" font-family="monospace" font-size="15" letter-spacing="2" fill="#f4ecda" opacity="0.75" text-anchor="middle">${sublabel}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Olive/brass-family colors, one per type, purely so the five placeholder
// cards are visually distinguishable from each other at a glance.
const COLORS = {
  movie: '#6b4a24',
  series: '#4a5a3a',
  short: '#7a5a35',
  vertical: '#3a4a5a',
  podcast: '#5a3a4a'
};

function baseFields(overrides) {
  return {
    tier: 'free',
    rating: 'PG-13',
    release_year: new Date().getFullYear(),
    video_type: 'html5',
    src: null,
    trailer_src: null,
    featured: false,
    is_original: false,
    funding_url: null,
    audio_url: null,
    ads_enabled: true,
    ad_break_seconds: [0],
    status: 'approved',
    is_placeholder: true,
    ...overrides
  };
}

// One item per content type (bonus excluded deliberately — it requires
// an existing parent to attach to, which doesn't fit a from-scratch
// generator). None of these have a real video or audio file behind them,
// since there's no way to fabricate a genuine Cloudflare Stream video —
// this is for checking layout, cards, and metadata display, not
// exercising actual playback.
export async function generatePlaceholderContent() {
  const supabase = getSupabase();
  const stamp = Date.now().toString(36);
  const results = { created: [], errors: [] };

  const movieId = `placeholder-movie-${stamp}`;
  const shortId = `placeholder-short-${stamp}`;
  const verticalId = `placeholder-vertical-${stamp}`;
  const seriesId = `placeholder-series-${stamp}`;
  const podcastShowId = `placeholder-podcast-show-${stamp}`;
  const podcastEpId = `placeholder-podcast-ep-${stamp}`;

  const rows = [
    {
      id: movieId,
      title: '[Placeholder] Harbor Lights',
      description: 'A generated placeholder movie for checking layout across browse pages, hero sections, and the episode detail page. Safe to delete anytime.',
      genre: 'Drama',
      main_genre: 'Drama',
      content_type: 'movie',
      series_id: null,
      season: null,
      series_order: null,
      artist: 'Placeholder Pictures',
      runtime: '1:32:00',
      thumbnail: svgThumbnail('MOVIE', 'PLACEHOLDER', COLORS.movie),
      poster: svgThumbnail('MOVIE', 'PLACEHOLDER', COLORS.movie),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    },
    {
      id: shortId,
      title: '[Placeholder] Three Minutes to Sundown',
      description: 'A generated placeholder short film. Safe to delete anytime.',
      genre: 'Experimental',
      main_genre: 'Experimental',
      content_type: 'short',
      series_id: null,
      season: null,
      series_order: null,
      artist: 'Placeholder Pictures',
      runtime: '0:03:00',
      thumbnail: svgThumbnail('SHORT', 'PLACEHOLDER', COLORS.short),
      poster: svgThumbnail('SHORT', 'PLACEHOLDER', COLORS.short),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    },
    {
      id: verticalId,
      title: '[Placeholder] Quick Take: Studio Notes',
      description: 'A generated placeholder vertical clip. Safe to delete anytime.',
      genre: 'Behind the Scenes',
      main_genre: 'Behind the Scenes',
      content_type: 'vertical',
      series_id: null,
      season: null,
      series_order: null,
      artist: 'Placeholder Pictures',
      runtime: '0:01:30',
      thumbnail: svgThumbnail('VERTICAL', 'PLACEHOLDER', COLORS.vertical),
      poster: svgThumbnail('VERTICAL', 'PLACEHOLDER', COLORS.vertical),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    },
    {
      id: `${seriesId}-ep1`,
      title: '[Placeholder] Pilot',
      description: 'A generated placeholder series episode. Safe to delete anytime.',
      genre: 'Sci-Fi',
      main_genre: 'Sci-Fi',
      content_type: 'series',
      series_id: seriesId,
      season: 1,
      series_order: 1,
      artist: 'Placeholder Pictures',
      runtime: '0:44:00',
      thumbnail: svgThumbnail('SERIES', 'EP 1 \u00b7 PLACEHOLDER', COLORS.series),
      poster: svgThumbnail('SERIES', 'PLACEHOLDER', COLORS.series),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    },
    {
      id: `${seriesId}-ep2`,
      title: '[Placeholder] Static',
      description: 'A generated placeholder series episode. Safe to delete anytime.',
      genre: 'Sci-Fi',
      main_genre: 'Sci-Fi',
      content_type: 'series',
      series_id: seriesId,
      season: 1,
      series_order: 2,
      artist: 'Placeholder Pictures',
      runtime: '0:41:00',
      thumbnail: svgThumbnail('SERIES', 'EP 2 \u00b7 PLACEHOLDER', COLORS.series),
      poster: svgThumbnail('SERIES', 'PLACEHOLDER', COLORS.series),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    },
    {
      id: podcastEpId,
      title: '[Placeholder] Episode 1: Getting Started',
      description: 'A generated placeholder podcast episode (audio-only, no real audio file attached). Safe to delete anytime.',
      genre: 'Talk',
      main_genre: 'Talk',
      content_type: 'podcast',
      series_id: podcastShowId,
      season: 1,
      series_order: 1,
      artist: 'Placeholder Host',
      runtime: '0:28:00',
      thumbnail: svgThumbnail('PODCAST', 'PLACEHOLDER', COLORS.podcast),
      poster: svgThumbnail('PODCAST', 'PLACEHOLDER', COLORS.podcast),
      bonus_parent_type: null,
      bonus_parent_id: null,
      submitted_by: null,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      ...baseFields({})
    }
  ];

  // Two series rows need to exist first — episodes reference them by
  // series_id, and the podcast grouping logic (lib/podcastShow.js) reads
  // shows the same way it reads any other series.
  const { error: seriesErr } = await supabase.from('series').insert([
    { id: seriesId, name: '[Placeholder] The Long Signal', creator_id: null, is_placeholder: true },
    { id: podcastShowId, name: '[Placeholder] Placeholder Radio Hour', creator_id: null, is_placeholder: true }
  ]);
  if (seriesErr) {
    results.errors.push(`series: ${seriesErr.message}`);
    return results;
  }

  const { error: epErr } = await supabase.from('episodes').insert(rows);
  if (epErr) {
    results.errors.push(`episodes: ${epErr.message}`);
    return results;
  }

  results.created = rows.map((r) => ({ id: r.id, title: r.title, contentType: r.content_type }));
  return results;
}

// Bulk cleanup — removes every row ever marked is_placeholder, regardless
// of which generation run created it. Simple and predictable: one button,
// one guaranteed-clean result, no partial state to reason about.
export async function removePlaceholderContent() {
  const supabase = getSupabase();
  const { error: epErr, count: epCount } = await supabase
    .from('episodes')
    .delete({ count: 'exact' })
    .eq('is_placeholder', true);
  if (epErr) {
    return { removed: 0, error: epErr.message };
  }
  const { error: seriesErr, count: seriesCount } = await supabase
    .from('series')
    .delete({ count: 'exact' })
    .eq('is_placeholder', true);
  if (seriesErr) {
    return { removed: epCount || 0, error: `Episodes removed, but series cleanup failed: ${seriesErr.message}` };
  }
  return { removed: (epCount || 0) + (seriesCount || 0), error: null };
}
