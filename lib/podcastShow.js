import { getSupabase } from './supabase';
import { signedSrcForStoredUrl, unsignedFallback } from './videoSigning';
import { playableAudioUrl } from './podcastAudio';

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
//
// opts.statuses (slice 4): the owner's preview of a show that isn't public
// passes ['approved', 'pending'] so its episodes in review are listed too;
// every row then carries `status`.
// opts.preview (slice 4) = { userId, team, ownerId, held }: in the preview
// the tier and the age don't decide — who the viewer is does (the rule
// /api/stream-token's preview follows, lib/episodes.js
// findEpisodeForPreview): the team plays every row, the show's owner and a
// row's own uploader play that row, and nobody but the team plays
// anything while the show is held. Every other row is locked, with
// `previewLock` 'held' (the show is pulled) or 'others' (someone else's).
export async function getPodcastShowEpisodes(seriesId, isSubscriber, age = null, { statuses = null, preview = null } = {}) {
  const supabase = getSupabase();
  const wanted = Array.isArray(statuses) && statuses.length ? statuses.filter((st) => st === 'approved' || st === 'pending') : null;
  const pv = preview && typeof preview === 'object' ? preview : null;
  let query = supabase
    .from('episodes')
    .select('id, title, description, tier, rating, artist, runtime, season, series_order, src, audio_url, poster, thumbnail, created_at, status, submitted_by')
    .eq('series_id', seriesId)
    .eq('content_type', 'podcast');
  query = wanted ? query.in('status', wanted) : query.eq('status', 'approved');
  const { data, error } = await query
    .eq('deletion_requested', false).eq('moderation_hold', false)
    .or(`available_until.is.null,available_until.gt.${new Date().toISOString()}`)
    .order('season', { ascending: true })
    .order('series_order', { ascending: true });

  if (error) {
    console.error('getPodcastShowEpisodes error:', error.message);
    return [];
  }

  return Promise.all(data.map(async (row) => {
    const ageOk = age ? age.allows(row.rating) : true;
    let previewLock = null;
    if (pv) {
      const mine = Boolean(pv.userId && (pv.userId === pv.ownerId || (row.submitted_by && row.submitted_by === pv.userId)));
      if (pv.held && !pv.team) previewLock = 'held';
      else if (!pv.team && !mine) previewLock = 'others';
    }
    const entitled = pv ? !previewLock : (row.tier === 'free' || isSubscriber) && ageOk;
    // Premium video needs the short-lived signed URL, same as the episode
    // page; the raw stored URL used to go out and wouldn't play.
    // Every Cloudflare video demands a signed link, free ones included
    // (lib/streamProtection.js), so every entitled video is signed here;
    // until 2026-10-26 only premium ones were, and free ones went out at
    // their permanent address.
    let src = entitled ? row.src : null;
    if (src) {
      const signed = await signedSrcForStoredUrl(src);
      src = signed ? signed.src : unsignedFallback(src);
    }
    return {
      id: row.id,
      title: row.title,
      desc: row.description,
      tier: row.tier,
      rating: row.rating || null,
      artist: row.artist || null,
      ageRestricted: !ageOk,
      // No age on file but the rating is under 17+: the viewing terms unlock it.
      termsWouldUnlock: !ageOk && Boolean(age) && age.viewerAge == null && age.termsWouldClear(row.rating),
      runtime: row.runtime,
      season: row.season,
      seriesOrder: row.series_order,
      poster: row.poster,
      thumbnail: row.thumbnail,
      createdAt: row.created_at,
      src,
      signedPlayback: Boolean(src) && row.tier === 'premium',
      // Never the stored file (Jose, 2026-11-12): the audio route with a
      // key minted now, after this viewer's check (lib/podcastAudio.js) —
      // a listener's, or the preview's (the team's when the viewer is on
      // it). The route signs a link that lasts a few hours.
      audioUrl: entitled && row.audio_url ? playableAudioUrl(row.id, row.audio_url, pv ? (pv.team ? 't' : 'p') : 'v') : null,
      // Podcasts are ad-free (Jose, 2026-11-13; lib/adBreakRules.js
      // adFreeContent): whatever the row's own switch says, no ad of ours
      // plays on one, so none is described here.
      adsEnabled: false,
      locked: !entitled,
      ...(wanted ? { status: row.status || null } : {}),
      ...(pv ? { previewLock } : {})
    };
  }));
}
