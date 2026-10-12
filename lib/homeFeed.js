import { getPublicEpisodes } from './publicEpisodes';
import { getActiveAnnouncements } from './announcements';
import { getFeaturedCreators } from './userProfiles';
import { getApprovedPitches } from './pitches';
import { getAllSeries } from './series';
import { getCurrentLiveStream } from './liveStreams';
import { getViewCounts, isRedisConfigured } from './redis';
import { getSiteSettings } from './siteSettings';
import { searchCards } from './crewCards';
import { listCalls, getTrackRecords } from './crewCalls';

const CREW_ROW_MILES = 50;

// The homepage's content selection/ranking, shared by the website
// (pages/index.js) and the public home-feed API (pages/api/home-feed.js,
// used by the mobile app) so these rules only ever live in one place.
//
// `viewer` ({ userId, near: { label, lat, lng } } or nothing) makes the
// two Crew Call rows personal — "Open to work near you" and calls near
// the viewer's own card — and hides people the viewer has blocked. A
// signed-out visitor gets the newest instead.
export async function getHomeFeedData(viewer = {}) {
  const needsViewCounts = isRedisConfigured();
  const near = viewer.near && Number.isFinite(viewer.near.lat) ? viewer.near : null;
  const crewFilters = { lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? CREW_ROW_MILES : 0 };
  const [episodes, announcements, featuredCreators, allPitchRows, allSeries, liveStream, viewCounts, siteSettings, crewPeople, crewCalls] = await Promise.all([
    getPublicEpisodes(),
    getActiveAnnouncements(),
    getFeaturedCreators(4),
    getApprovedPitches(),
    getAllSeries(),
    getCurrentLiveStream(),
    needsViewCounts ? getViewCounts() : Promise.resolve({}),
    getSiteSettings().catch(() => ({})),
    searchCards({ ...crewFilters, openOnly: true }, { showRates: false, viewerId: viewer.userId || null }).catch(() => ({ people: [] })),
    listCalls(crewFilters, { viewerId: viewer.userId || null }).catch(() => ({ calls: [] }))
  ]);
  // The Pitch Room rows used to show even with Pitch Room switched off
  // in Settings (the pages themselves 404 then).
  const pitchRows = siteSettings.elevatorPitchEnabled === false ? [] : allPitchRows;

  // Crew Call rows (step 4): a handful of people open to work, nearest
  // first when we know where the viewer is, and the newest calls.
  const openPeople = crewPeople.people.slice(0, 6);
  const records = openPeople.length ? await getTrackRecords(openPeople.map((p) => p.userId)).catch(() => ({})) : {};
  const openToWork = openPeople.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    profilePath: p.profilePath,
    verified: p.verified,
    roles: p.roles.slice(0, 2),
    gear: p.gear.slice(0, 2).map((g) => g.name),
    place: p.place,
    miles: p.miles,
    remoteOk: p.remoteOk,
    tier: records[p.userId] ? records[p.userId].tier : null,
    done: records[p.userId] ? records[p.userId].done : 0
  }));
  const newCalls = crewCalls.calls.slice(0, 4).map((c) => ({
    id: c.id,
    title: c.title,
    role: c.role,
    spots: c.spots,
    payType: c.payType,
    payLabel: c.payLabel,
    payNote: c.payNote,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    remote: c.remote,
    place: c.place,
    miles: c.miles,
    projectTitle: c.projectTitle,
    posterName: c.poster.displayName,
    posterTier: c.poster.tier,
    posterDone: c.poster.done,
    responsesCount: c.responsesCount
  }));
  const crewNearLabel = near ? near.label : null;

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
  // Bonus clips never front the page; a featured podcast is fine (the page
  // links it to its show).
  const heroItem = episodes.find((e) => e.featured && e.contentType !== 'bonus') || filmsAndShorts[0] || null;
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
      .filter((e) => e.contentType !== 'series' && e.contentType !== 'bonus')
      // contentType/seriesId ride along so the page can link a podcast to
      // its show instead of the video page (lib/episodeLinks.js).
      .map((e) => ({ id: e.id, title: e.title, poster: e.poster || e.thumbnail, tag: e.contentType.toUpperCase(), views: viewCounts[e.id] || 0, contentType: e.contentType, seriesId: e.seriesId || null })),
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
    liveStream,
    openToWork,
    newCalls,
    crewNearLabel
  };
}
