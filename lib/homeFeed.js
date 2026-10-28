import { getPublicEpisodes } from './publicEpisodes';
import { getActiveAnnouncements } from './announcements';
import { getFeaturedCreators, getPublicIdentities } from './userProfiles';
import { getApprovedPitches } from './pitches';
import { getCurrentLiveStream } from './liveStreams';
import { getSiteSettings } from './siteSettings';
import { getOwnCard, searchCards } from './crewCards';
import { listCalls, getTrackRecords } from './crewCalls';
import { searchListings } from './locations';
import { listProductions } from './productions';
import { listPartners } from './partners';
import { getUniversityFeed } from './university';
import { getFollowedUserIds } from './follows';
import { getSupabase } from './supabase';

const CREW_ROW_MILES = 50;
const NEW_PLACE_DAYS = 7;

// The Connect homepage ("The Notice Board", built 2026-10-28 from the
// signed-off canvas, direction I: A's corkboard with B and D's desk
// beside it). Shared by the website (pages/index.js) and the public
// home-feed API (pages/api/home-feed.js, the mobile app) so the rules
// live in one place.
//
// The board is what the community pinned this week: urgent calls, pitches
// raising money, the faces behind released work, casting, places to
// shoot, shoots under way, the studio's own notes, who is free right now,
// a course and a partner deal. Films, series and podcasts live on Stream
// now; the page points there once at the bottom.
//
// `viewer` ({ userId, near: { label, lat, lng } } or nothing) makes the
// nearby rows personal (calls, places, people measured from the viewer's
// own card) and hides people the viewer has blocked. With a userId the
// feed also carries `desk`: the viewer's own card, what needs them
// (unread notifications), who they might follow and their course.
export async function getHomeFeedData(viewer = {}) {
  const userId = viewer.userId || null;
  const near = viewer.near && Number.isFinite(viewer.near.lat) ? viewer.near : null;
  const nearFilters = { lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? CREW_ROW_MILES : 0 };
  const soft = (p, fallback) => p.catch((err) => { console.error('home feed:', err.message); return fallback; });

  const [episodes, announcements, featuredCreators, allPitchRows, liveStream, siteSettings, crewPeople, freePeople, crewCalls, places, productions, partners, university, followedIds, ownCard, notifications] = await Promise.all([
    getPublicEpisodes(),
    soft(getActiveAnnouncements(), []),
    soft(getFeaturedCreators(6), []),
    soft(getApprovedPitches(), []),
    soft(getCurrentLiveStream(), null),
    getSiteSettings().catch(() => ({})),
    soft(searchCards({ ...nearFilters, openOnly: true }, { showRates: false, viewerId: userId }), { people: [] }),
    soft(searchCards({ ...nearFilters, freeNow: true }, { showRates: false, viewerId: userId }), { people: [] }),
    soft(listCalls(nearFilters, { viewerId: userId }), { calls: [], total: 0, urgentCount: 0 }),
    soft(searchListings({ ...nearFilters }, { viewerId: userId }), { listings: [], total: 0 }),
    soft(listProductions({}, { viewerId: userId }), { productions: [], total: 0 }),
    soft(listPartners(nearFilters, { viewerId: userId }), { partners: [] }),
    soft(getUniversityFeed({ userId }), null),
    userId ? soft(getFollowedUserIds(userId), []) : Promise.resolve([]),
    userId ? soft(getOwnCard(userId), null) : Promise.resolve(null),
    userId ? soft(unreadNotifications(userId), { items: [], count: 0 }) : Promise.resolve({ items: [], count: 0 })
  ]);

  // The Pitch Room rows used to show even with Pitch Room switched off
  // in Settings (the pages themselves 404 then).
  const pitchRows = siteSettings.elevatorPitchEnabled === false ? [] : allPitchRows;
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  // Calls: the urgent ones still live pin first, then casting, then the
  // newest crew calls. Each list is short; the board is a sampler.
  const liveUrgent = (c) => c.urgent && c.neededBy && Date.parse(c.neededBy) > Date.now();
  const calls = crewCalls.calls || [];
  const urgentCalls = calls.filter(liveUrgent).slice(0, 2).map(shapeCall);
  const castingCalls = calls.filter((c) => c.kind === 'cast' && !liveUrgent(c)).slice(0, 2).map(shapeCall);
  const newCalls = calls.filter((c) => c.kind !== 'cast' && !liveUrgent(c)).slice(0, 3).map(shapeCall);

  const people = crewPeople.people || [];
  const records = people.length ? await getTrackRecords(people.map((p) => p.userId)).catch(() => ({})) : {};
  const openToWork = people.slice(0, 6).map((p) => shapePerson(p, records));
  const freeNow = (freePeople.people || []).filter((p) => p.freeNow).slice(0, 4).map((p) => shapePerson(p, records));

  const pitches = pitchRows.slice(0, 3).map((p) => ({
    id: p.id,
    title: p.title,
    tag: p.tag || null,
    logline: p.logline || p.description || null,
    fundingRaised: p.funding_raised == null ? null : Number(p.funding_raised),
    fundingGoal: p.funding_goal == null ? null : Number(p.funding_goal),
    creatorName: p.creator_name || null,
    creatorUserId: p.created_by || null
  }));

  const listings = places.listings || [];
  const weekAgo = Date.now() - NEW_PLACE_DAYS * 86400000;
  const placeCards = listings.slice(0, 2).map((l) => ({
    id: l.id,
    title: l.title,
    kindLabel: l.kindLabel,
    placeLabel: l.place ? (l.place.city || l.place.label) : null,
    miles: l.miles,
    rateLine: l.rateLine,
    studioRateLine: l.studioRateLine || null,
    shootsCount: l.shootsCount || 0,
    titlesShotHere: l.titlesShotHere || 0,
    photo: l.photos && l.photos[0] ? l.photos[0].url : null,
    hostName: l.host ? l.host.displayName : null
  }));

  const prods = productions.productions || [];
  const shooting = prods.filter((p) => p.status === 'shooting').slice(0, 2).map(shapeProduction);

  const deal = (partners.partners || []).find((p) => p.deal) || null;
  const dealCard = deal ? { id: deal.id, name: deal.name, kindLabel: deal.kindLabel, deal: deal.deal, hasCode: deal.hasCode, gateLabel: deal.gateLabel || null, canReveal: Boolean(deal.canReveal) } : null;

  const course = shapeCourse(university);

  const counts = {
    openCalls: crewCalls.total || calls.length,
    urgent: crewCalls.urgentCount || urgentCalls.length,
    raising: pitchRows.length,
    newPlaces: listings.filter((l) => l.updatedAt && Date.parse(l.updatedAt) > weekAgo).length,
    places: places.total || listings.length,
    shooting: prods.filter((p) => p.status === 'shooting').length,
    freeNow: freeNow.length
  };

  // Faces to follow: people open to work near the viewer first (a reason
  // in roles and miles), then creators with released work, skipping the
  // viewer and anyone they already follow.
  const followed = new Set(followedIds);
  const facesToFollow = [];
  for (const p of openToWork) {
    if (facesToFollow.length >= 4) break;
    if (p.userId === userId || followed.has(p.userId)) continue;
    facesToFollow.push({ userId: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl, avatarPosition: p.avatarPosition, avatarZoom: p.avatarZoom, profilePath: p.profilePath, why: [p.roles.join(' · '), p.miles != null ? `${p.miles} mi from you` : (p.place || null)].filter(Boolean).join(' · ') });
  }
  for (const c of featuredCreators) {
    if (facesToFollow.length >= 4) break;
    if (c.userId === userId || followed.has(c.userId) || facesToFollow.some((f) => f.userId === c.userId)) continue;
    facesToFollow.push({ userId: c.userId, displayName: c.displayName, avatarUrl: c.avatarUrl, avatarPosition: c.avatarPosition, avatarZoom: c.avatarZoom, profilePath: `/profile/${c.handle || c.userId}`, why: c.credits.slice(0, 2).join(', ') });
  }

  let desk = null;
  if (userId) {
    const identity = (await getPublicIdentities([userId]).catch(() => ({})))[userId] || null;
    const tier = ownCard ? (await getTrackRecords([userId]).catch(() => ({})))[userId] || null : null;
    desk = {
      displayName: identity ? identity.displayName : null,
      userId,
      avatarUrl: identity ? identity.avatarUrl || null : null,
      avatarPosition: identity ? identity.avatarPosition || null : null,
      avatarZoom: identity ? identity.avatarZoom || null : null,
      card: ownCard ? {
        roles: ownCard.roles,
        placeLabel: ownCard.place ? ownCard.place.label : null,
        travelMiles: ownCard.travelMiles,
        remoteOk: ownCard.remoteOk,
        availability: ownCard.availability,
        freeNow: ownCard.freeNow,
        availableNowUntil: ownCard.availableNowUntil,
        tier: tier ? tier.tier : null,
        done: tier ? tier.done : 0
      } : null,
      needs: notifications.items,
      unreadCount: notifications.count
    };
  }

  return {
    mainGenres,
    liveStream,
    announcements: announcements.slice(0, 2),
    featuredCreators: featuredCreators.slice(0, 4),
    urgentCalls,
    castingCalls,
    newCalls,
    pitches,
    places: placeCards,
    shooting,
    freeNow,
    openToWork,
    course,
    deal: dealCard,
    counts,
    facesToFollow,
    crewNearLabel: near ? near.label : null,
    desk
  };
}

function shapeCall(c) {
  return {
    id: c.id,
    title: c.title,
    kind: c.kind,
    role: c.role,
    characterName: c.characterName || null,
    playingAge: c.playingAgeMin != null || c.playingAgeMax != null ? [c.playingAgeMin, c.playingAgeMax].filter((n) => n != null).join('–') : null,
    unionLabel: c.unionLabel || null,
    selfTapeDue: c.selfTapeDue || null,
    spots: c.spots,
    payType: c.payType,
    payLabel: c.payLabel,
    payNote: c.payNote,
    paySecured: Boolean(c.paySecured),
    payRateCents: c.payRateCents || null,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    urgent: Boolean(c.urgent),
    neededBy: c.neededBy || null,
    neededLabel: c.neededLabel || null,
    remote: c.remote,
    place: c.place,
    miles: c.miles,
    projectTitle: c.projectTitle,
    posterName: c.poster.displayName,
    posterTier: c.poster.tier,
    posterDone: c.poster.done,
    responsesCount: c.responsesCount
  };
}

function shapePerson(p, records) {
  return {
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    avatarPosition: p.avatarPosition || null,
    avatarZoom: p.avatarZoom || null,
    profilePath: p.profilePath,
    verified: p.verified,
    roles: p.roles.slice(0, 2),
    gear: p.gear.slice(0, 2).map((g) => g.name),
    place: p.place,
    miles: p.miles,
    remoteOk: p.remoteOk,
    freeNow: Boolean(p.freeNow),
    availableNowUntil: p.availableNowUntil || null,
    tier: records[p.userId] ? records[p.userId].tier : null,
    done: records[p.userId] ? records[p.userId].done : 0
  };
}

function shapeProduction(p) {
  return {
    id: p.id,
    title: p.title,
    kindLabel: p.kindLabel,
    status: p.status,
    statusLabel: p.statusLabel,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    placeLabel: p.place ? p.place.label : null,
    membersCount: p.membersCount || 0,
    daysCount: p.daysCount || 0,
    openCalls: p.openCalls || 0,
    ownerName: p.owner ? p.owner.displayName : null
  };
}

// The course card: the viewer's next lesson when they have started one,
// else the newest course on the catalogue.
function shapeCourse(feed) {
  if (!feed) return null;
  if (feed.continue) {
    const c = feed.continue;
    return { slug: c.course.slug, title: c.course.title, levelLabel: c.course.levelLabel || null, lessonSlug: c.lesson.slug, lessonTitle: c.lesson.title, doneCount: c.doneCount, total: c.total, remaining: c.remaining || null, started: true };
  }
  const newest = feed.courses[0];
  if (!newest) return null;
  return { slug: newest.slug, title: newest.title, levelLabel: newest.levelLabel || null, lessonSlug: null, lessonTitle: null, doneCount: 0, total: newest.lessonCount || 0, remaining: null, started: false };
}

// "Needs you": the newest unread notifications, each with where to go.
async function unreadNotifications(userId, limit = 5) {
  const supabase = getSupabase();
  const { data, error, count } = await supabase
    .from('notifications')
    .select('id, type, message, episode_id, pitch_id, href, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const items = (data || []).map((n) => ({
    id: n.id,
    type: n.type,
    message: n.message,
    href: n.href || (n.type === 'message' ? '/messages' : n.episode_id ? `/episode/${n.episode_id}` : n.pitch_id ? `/pitches/${n.pitch_id}` : null),
    createdAt: n.created_at
  }));
  return { items, count: count == null ? items.length : count };
}
