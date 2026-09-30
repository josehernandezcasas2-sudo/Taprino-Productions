import { getPublicEpisodes } from './publicEpisodes';
import { getActiveAnnouncements } from './announcements';
import { getFeaturedCreators } from './userProfiles';
import { getApprovedPitches } from './pitches';
import { getAllSeries } from './series';
import { getCurrentLiveStream } from './liveStreams';
import { getViewCounts, isRedisConfigured } from './redis';

// The homepage's content selection/ranking, shared by the website
// (pages/index.js) and the public home-feed API (pages/api/home-feed.js,
// used by the mobile app) so these rules only ever live in one place.
export async function getHomeFeedData() {
  const needsViewCounts = isRedisConfigured();
  const [episodes, announcements, featuredCreators, pitchRows, allSeries, liveStream, viewCounts] = await Promise.all([
    getPublicEpisodes(),
    getActiveAnnouncements(),
    getFeaturedCreators(4),
    getApprovedPitches(),
    getAllSeries(),
    getCurrentLiveStream(),
    needsViewCounts ? getViewCounts() : Promise.resolve({})
  ]);

  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const filmsAndShorts = episodes
    .filter((e) => e.contentType === 'movie' || e.contentType === 'short')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  const podcasts = episodes
    .filter((e) => e.contentType === 'podcast')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6);
  // Simple, honest hero pick for now: the most recent admin-flagged
  // "featured" item, falling back to the most recent film/short of any
  // kind so the hero is never empty just because nothing's been flagged.
  const heroItem = episodes.find((e) => e.featured) || filmsAndShorts[0] || null;
  const pitches = pitchRows.slice(0, 3).map((p) => ({
    id: p.id,
    title: p.title,
    tag: p.tag,
    logline: p.logline || p.description,
    fundingRaised: p.funding_raised,
    creatorName: p.creator_name || null,
    creatorUserId: p.created_by || null
  }));

  // Series row — same "consolidate episodes into one card per show" rule
  // GenreRow uses on /stream. Ranked by most recently active (latest
  // episode), same as the filmstrip above.
  const seriesEpisodeList = episodes.filter((e) => e.contentType === 'series');
  const seriesIds = [...new Set(seriesEpisodeList.map((e) => e.seriesId))];
  const seriesRows = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = seriesEpisodeList.filter((e) => e.seriesId === sid);
      if (!info) return null;
      const latestCreatedAt = eps.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), eps[0].createdAt);
      return {
        id: info.id,
        title: info.name,
        poster: info.poster || info.thumbnail,
        count: eps.length,
        latestCreatedAt,
        views: eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
    .slice(0, 8);

  // Trending — standalone titles and whole series ranked together by view
  // count. Falls back to insertion order when nothing has views yet. The
  // hero's own pick is excluded so the same title doesn't appear twice at
  // the top of the page.
  const trending = [
    ...episodes
      .filter((e) => e.contentType !== 'series')
      .map((e) => ({ id: e.id, title: e.title, poster: e.poster || e.thumbnail, tag: e.contentType.toUpperCase(), views: viewCounts[e.id] || 0 })),
    ...seriesRows.map((s) => ({ id: s.id, title: s.title, poster: s.poster, tag: 'SERIES', views: s.views, isSeries: true }))
  ]
    .filter((item) => !heroItem || item.id !== heroItem.id)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

  return {
    mainGenres,
    announcements,
    featuredCreators,
    filmsAndShorts,
    podcasts,
    heroItem,
    pitches,
    seriesRows,
    trending,
    liveStream
  };
}
