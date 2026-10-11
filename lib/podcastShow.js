import { getSupabase } from './supabase';
import { signedSrcForStoredUrl } from './videoSigning';

// Public-safe — same "never select src/audio_url" rule as
// lib/publicEpisodes.js, since this feeds the general browse grid where
// no entitlement check has happened yet. Groups approved podcast episodes
// by their series_id to build one card per show, not per episode.
export async function getPodcastShows() {
  const supabase = getSupabase();
  const [{ data: episodes, error: epError }, { data: series, error: seriesError }] = await Promise.all([
    supabase
      .from('episodes')
      .select('series_id, artist, tier, poster, thumbnail, audio_url, src')
      .eq('content_type', 'podcast')
      .eq('status', 'approved')
      .eq('deletion_requested', false).eq('moderation_hold', false),
    supabase.from('series').select('id, name, poster, thumbnail').eq('deletion_requested', false).eq('moderation_hold', false).or('status.eq.approved,status.is.null')
  ]);

  if (epError || seriesError) {
    console.error('getPodcastShows error:', (epError || seriesError).message);
    return [];
  }

  const seriesById = Object.fromEntries((series || []).map((s) => [s.id, s]));
  const showMap = new Map();

  for (const ep of episodes || []) {
    if (!ep.series_id || !seriesById[ep.series_id]) continue;
    if (!showMap.has(ep.series_id)) {
      const s = seriesById[ep.series_id];
      showMap.set(ep.series_id, {
        id: ep.series_id,
        name: s.name,
        art: s.poster || s.thumbnail || ep.poster || ep.thumbnail || null,
        host: ep.artist,
        episodeCount: 0,
        hasAudio: false,
        hasVideo: false
      });
    }
    const show = showMap.get(ep.series_id);
    show.episodeCount += 1;
    // Only the BOOLEAN presence is kept — the actual audio_url/src values
    // are never included in what this function returns, since this feeds
    // the general browse page where no entitlement check has happened.
    if (ep.audio_url) show.hasAudio = true;
    if (ep.src) show.hasVideo = true;
  }

  return Array.from(showMap.values());
}


// SERVER-ONLY, same rule as lib/episodes.js: call only from
// getServerSideProps. Unlike lib/publicEpisodes.js (which structurally
// never selects src/audio_url at all, for any viewer), this function DOES
// select them — a podcast show page needs instant play-from-list without
// a per-episode page navigation first. The security boundary here is
// per-row entitlement gating instead: audio_url/src are stripped back out
// for any episode the CURRENT viewer isn't actually entitled to, right
// before returning. Never reuse this function's output as if it were the
// safe general-browse subset — it's specifically for one show's own page,
// checked against one specific viewer's subscription status.
// `age` is lib/viewerAge.js's context: an episode the viewer is too young
// for (or whose age we don't know) is locked like a premium one, and its
// src/audioUrl never leave the server — the age gate used to be skipped
// on podcast pages entirely.
export async function getPodcastShowEpisodes(seriesId, isSubscriber, age = null) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, description, tier, rating, artist, runtime, season, series_order, src, audio_url, poster, thumbnail, created_at, ad_break_seconds, ads_enabled')
    .eq('series_id', seriesId)
    .eq('content_type', 'podcast')
    .eq('status', 'approved')
    .eq('deletion_requested', false).eq('moderation_hold', false)
    .order('season', { ascending: true })
    .order('series_order', { ascending: true });

  if (error) {
    console.error('getPodcastShowEpisodes error:', error.message);
    return [];
  }

  return Promise.all(data.map(async (row) => {
    const ageOk = age ? age.allows(row.rating) : true;
    const entitled = (row.tier === 'free' || isSubscriber) && ageOk;
    // Premium video needs the short-lived signed URL, same as the episode
    // page; the raw stored URL used to go out and wouldn't play.
    let src = entitled ? row.src : null;
    if (src && row.tier === 'premium') {
      const signed = await signedSrcForStoredUrl(src);
      if (signed) src = signed.src;
    }
    return {
      id: row.id,
      title: row.title,
      desc: row.description,
      tier: row.tier,
      rating: row.rating || null,
      artist: row.artist || null,
      ageRestricted: !ageOk,
      runtime: row.runtime,
      season: row.season,
      seriesOrder: row.series_order,
      poster: row.poster,
      thumbnail: row.thumbnail,
      createdAt: row.created_at,
      src,
      signedPlayback: Boolean(src) && row.tier === 'premium',
      audioUrl: entitled ? row.audio_url : null,
      adBreakSeconds: row.ad_break_seconds,
      adsEnabled: row.ads_enabled,
      locked: !entitled
    };
  }));
}
