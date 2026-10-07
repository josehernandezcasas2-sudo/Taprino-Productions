import { getSupabase } from './supabase';
import { parseRuntimeToSeconds } from './videoMetadata';
import { getCurrentLiveStream } from './liveStreams';
import { planDay, advanceBookmark, indexOfEpisode, segmentAt, addDays, weekStartOf, weekdayOf, wholeMinutes, SERIES_KINDS, DAY_SECONDS } from './channelPlan';

// Everything that loads channel data from the database and turns it into
// "what's on." The rules themselves live in lib/channelPlan.js (pure, and
// tested by scripts/test-channel-plan.mjs); this file only feeds them.

export const CHANNEL_TIMEZONE = 'America/Los_Angeles';

/* ---------------- channel time ---------------- */

const ptFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CHANNEL_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
function ptParts(ms) {
  const map = {};
  for (const p of ptFormat.formatToParts(new Date(ms))) map[p.type] = p.value;
  return { y: +map.year, mo: +map.month, d: +map.day, h: +map.hour % 24, mi: +map.minute, s: +map.second };
}

// { date: 'YYYY-MM-DD', sec: seconds since channel-time midnight }
export function channelClock(at = new Date()) {
  const p = ptParts(at.getTime());
  return { date: `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, sec: p.h * 3600 + p.mi * 60 + p.s };
}

function offsetMs(utcMs) {
  const p = ptParts(utcMs);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
}
// Absolute ms for a channel-time second on a date (DST-safe).
export function channelSecToMs(dateStr, sec) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d) + sec * 1000;
  let ms = naive - offsetMs(naive);
  const second = naive - offsetMs(ms);
  if (second !== ms) ms = second;
  return ms;
}

/* ---------------- channels ---------------- */

const CHANNEL_FIELDS = 'id, slug, name, number, description, logo_url, image_url, visibility, loop_started_at';

export function channelToPublic(c) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    number: c.number,
    description: c.description || null,
    logoUrl: c.logo_url || null,
    imageUrl: c.image_url || null,
    visibility: c.visibility
  };
}

export async function listChannels({ includeDrafts = false } = {}) {
  const supabase = getSupabase();
  let q = supabase.from('channels').select(CHANNEL_FIELDS).order('number', { ascending: true });
  if (!includeDrafts) q = q.eq('visibility', 'public');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getChannelBySlug(slug) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channels').select(CHANNEL_FIELDS).eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/* ---------------- what's allowed to air ---------------- */

const EP_FIELDS = 'id, title, description, tier, genre, rating, runtime, content_type, series_id, season, series_order, thumbnail, poster, release_year, channel_opt_in, created_at';

function epLabel(ep) {
  if (ep.series_order == null) return null;
  return ep.season != null ? `S${ep.season} E${ep.series_order}` : `E${ep.series_order}`;
}

// Published, not pulled by moderation, creator opted in (on the episode or
// its series), and has a real runtime. Anything else simply never airs; a
// slot pointing at it falls through to the loop.
export async function loadEligibleContent() {
  const supabase = getSupabase();
  const [{ data: eps, error }, { data: series, error: sErr }] = await Promise.all([
    supabase.from('episodes').select(EP_FIELDS).eq('status', 'approved').eq('deletion_requested', false).eq('moderation_hold', false),
    supabase.from('series').select('id, name, channel_opt_in, moderation_hold, thumbnail, poster').eq('deletion_requested', false)
  ]);
  if (error) throw new Error(error.message);
  if (sErr) throw new Error(sErr.message);

  const seriesById = Object.fromEntries((series || []).map((s) => [s.id, s]));
  const episodesById = {};
  for (const e of eps || []) {
    const s = e.series_id ? seriesById[e.series_id] : null;
    if (s && s.moderation_hold) continue;
    if (!e.channel_opt_in && !(s && s.channel_opt_in)) continue;
    const durationSeconds = parseRuntimeToSeconds(e.runtime);
    if (!durationSeconds) continue;
    episodesById[e.id] = {
      id: e.id,
      title: e.title,
      description: e.description || null,
      tier: e.tier,
      genre: e.genre || null,
      rating: e.rating || null,
      runtime: e.runtime,
      contentType: e.content_type,
      seriesId: e.series_id || null,
      seriesName: s ? s.name : null,
      season: e.season,
      seriesOrder: e.series_order,
      label: epLabel(e),
      thumbnail: e.thumbnail || (s ? s.thumbnail : null),
      poster: e.poster || (s ? s.poster : null),
      releaseYear: e.release_year || null,
      durationSeconds,
      createdAt: e.created_at
    };
  }

  const seriesEpisodes = {};
  for (const ep of Object.values(episodesById)) {
    if (!ep.seriesId) continue;
    (seriesEpisodes[ep.seriesId] = seriesEpisodes[ep.seriesId] || []).push(ep);
  }
  for (const list of Object.values(seriesEpisodes)) {
    list.sort((a, b) =>
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  return { episodesById, seriesEpisodes, seriesById };
}

async function loadApprovedMedia() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('channel_media')
    .select('id, title, kind, duration_seconds, thumbnail')
    .eq('status', 'approved')
    .eq('moderation_hold', false);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).filter((m) => m.duration_seconds > 0).map((m) => [m.id, {
    id: m.id, title: m.title, kind: m.kind, thumbnail: m.thumbnail || null, durationSeconds: m.duration_seconds
  }]));
}

/* ---------------- schedule data for a channel ---------------- */

const SLOT_FIELDS = 'id, channel_id, layer, air_date, day_of_week, start_time, duration_seconds, kind, episode_id, media_id, series_id, pin_episode_id, rerun_of, title';

async function loadChannelSchedule(channelId, fromDate, toDate) {
  const supabase = getSupabase();
  const [weekRes, defRes, pubRes, loopRes] = await Promise.all([
    supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channelId).eq('layer', 'week').gte('air_date', fromDate).lte('air_date', toDate),
    supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channelId).eq('layer', 'default'),
    supabase.from('channel_weeks').select('week_start, published_at').eq('channel_id', channelId).not('published_at', 'is', null)
      .gte('week_start', weekStartOf(fromDate)).lte('week_start', toDate),
    supabase.from('channel_schedule').select('position, duration_seconds, episode_id').eq('channel_id', channelId).order('position', { ascending: true })
  ]);
  for (const r of [weekRes, defRes, pubRes, loopRes]) if (r.error) throw new Error(r.error.message);
  const weekSlotsByDate = {};
  for (const s of weekRes.data || []) (weekSlotsByDate[s.air_date] = weekSlotsByDate[s.air_date] || []).push(s);
  const defaultByDay = {};
  for (const s of defRes.data || []) (defaultByDay[s.day_of_week] = defaultByDay[s.day_of_week] || []).push(s);
  return {
    weekSlotsByDate,
    defaultByDay,
    publishedWeeks: new Set((pubRes.data || []).map((w) => w.week_start)),
    loopRows: loopRes.data || []
  };
}

// Episode/media slots always use the real runtime, not whatever was stored
// when the slot was made — so a runtime fix on the episode can't leave a
// slot cutting the episode off early.
function withRealDurations(slots, content, mediaById) {
  return slots.map((s) => {
    if (s.kind === 'episode' && content.episodesById[s.episode_id]) return { ...s, duration_seconds: content.episodesById[s.episode_id].durationSeconds };
    if (s.kind === 'media' && mediaById[s.media_id]) return { ...s, duration_seconds: mediaById[s.media_id].durationSeconds };
    return s;
  });
}

function dayInfoFrom(sched, content, mediaById) {
  return (date) => ({
    weekPublished: sched.publishedWeeks.has(weekStartOf(date)),
    weekSlots: withRealDurations(sched.weekSlotsByDate[date] || [], content, mediaById)
  });
}

/* ---------------- Continue-block bookmarks ---------------- */

// Start index for a default-layer Continue block on `date`. Moves the stored
// bookmark forward through every day the block actually aired, and saves
// that progress for days that are already in the past or today — never for
// future dates (the guide can preview tomorrow without committing to it).
// progressCache holds the bookmark rows already read in this request
// (slot id -> row, or null for "none yet"), so planning many days doesn't
// re-read them for every day.
async function continueStartFor(slot, date, today, eps, sched, content, mediaById, progressCache) {
  if (slot.layer !== 'default' || !eps.length) return 0;
  const supabase = getSupabase();
  let prog = progressCache[slot.id];
  if (prog === undefined) {
    const { data, error } = await supabase.from('channel_block_progress').select('next_episode_id, as_of_date').eq('slot_id', slot.id).maybeSingle();
    if (error) throw new Error(error.message);
    prog = data || null;
  }

  if (!prog) {
    await supabase.from('channel_block_progress').upsert(
      { slot_id: slot.id, next_episode_id: eps[0].id, as_of_date: today },
      { onConflict: 'slot_id', ignoreDuplicates: true }
    );
    progressCache[slot.id] = { next_episode_id: eps[0].id, as_of_date: today };
    prog = progressCache[slot.id];
  }

  const startIdx = indexOfEpisode(eps, prog.next_episode_id);
  if (date <= prog.as_of_date) return startIdx;

  // Week slots for the whole span are needed to know which days it aired.
  let spanSched = sched;
  if (prog.as_of_date < sched.fromDate) {
    spanSched = { ...(await loadChannelSchedule(slot.channel_id, prog.as_of_date, date)), fromDate: prog.as_of_date };
  }
  const dayInfo = dayInfoFrom(spanSched, content, mediaById);
  const slotWithDur = { ...slot };

  const settleTo = date <= today ? date : today;
  const settledIdx = advanceBookmark({ slot: slotWithDur, episodes: eps, startIdx, asOfDate: prog.as_of_date, targetDate: settleTo, dayInfo });
  if (settleTo > prog.as_of_date) {
    // Only moves forward from the exact state we read, so two requests at
    // once can't both advance it.
    await supabase.from('channel_block_progress')
      .update({ next_episode_id: eps[settledIdx].id, as_of_date: settleTo, updated_at: new Date().toISOString() })
      .eq('slot_id', slot.id).eq('as_of_date', prog.as_of_date);
    progressCache[slot.id] = { next_episode_id: eps[settledIdx].id, as_of_date: settleTo };
  }
  if (settleTo === date) return settledIdx;
  return advanceBookmark({ slot: slotWithDur, episodes: eps, startIdx: settledIdx, asOfDate: settleTo, targetDate: date, dayInfo });
}

/* ---------------- planning ---------------- */

// Plans several consecutive days in one go (the guide shows today and can
// page forward). Returns { [date]: segments[] } with segments enriched for
// display.
export async function planChannelDays(channel, dates, { includeLive = true, at = new Date() } = {}) {
  const today = channelClock(at).date;
  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];
  const [content, mediaById, schedRaw] = await Promise.all([
    loadEligibleContent(),
    loadApprovedMedia(),
    loadChannelSchedule(channel.id, fromDate, toDate)
  ]);
  const sched = { ...schedRaw, fromDate };
  const loop = sched.loopRows
    .map((r) => ({ episode: content.episodesById[r.episode_id], durationSeconds: content.episodesById[r.episode_id] ? content.episodesById[r.episode_id].durationSeconds : 0 }))
    .filter((l) => l.episode);
  const loopStartedAtMs = new Date(channel.loop_started_at).getTime();
  const dayInfo = dayInfoFrom(sched, content, mediaById);

  // Read every Continue block's bookmark once, up front.
  const progressCache = {};
  const continueIds = Object.values(sched.defaultByDay).flat().filter((s) => s.kind === 'series_continue').map((s) => s.id);
  if (continueIds.length) {
    const { data: rows, error } = await getSupabase().from('channel_block_progress').select('slot_id, next_episode_id, as_of_date').in('slot_id', continueIds);
    if (error) throw new Error(error.message);
    for (const id of continueIds) progressCache[id] = null;
    for (const r of rows || []) progressCache[r.slot_id] = { next_episode_id: r.next_episode_id, as_of_date: r.as_of_date };
  }

  const out = {};
  for (const date of dates) {
    const { weekPublished, weekSlots } = dayInfo(date);
    const defaultSlots = withRealDurations(sched.defaultByDay[weekdayOf(date)] || [], content, mediaById);

    const continueIdx = {};
    for (const s of [...weekSlots, ...defaultSlots]) {
      if (s.kind === 'series_continue') {
        continueIdx[s.id] = await continueStartFor(s, date, today, content.seriesEpisodes[s.series_id] || [], sched, content, mediaById, progressCache);
      }
    }

    const segments = planDay({
      date,
      weekPublished,
      weekSlots,
      defaultSlots,
      episodesById: content.episodesById,
      mediaById,
      seriesEpisodes: content.seriesEpisodes,
      continueStart: (s) => continueIdx[s.id] || 0,
      loop,
      loopStartedAtMs,
      secToMs: (sec) => channelSecToMs(date, sec)
    }, { includeLive });

    out[date] = segments.map((s) => decorate(s, content, mediaById));
  }
  return out;
}

function decorate(seg, content, mediaById) {
  const base = {
    start: seg.start,
    end: seg.end,
    kind: seg.kind,
    layer: seg.layer,
    blockKind: seg.blockKind || null,
    slotId: seg.slotId || null,
    startOffset: seg.startOffset || 0,
    filler: !!seg.filler
  };
  if (seg.kind === 'episode') {
    const ep = content.episodesById[seg.episodeId];
    return {
      ...base,
      episodeId: ep.id,
      title: ep.title,
      seriesId: ep.seriesId,
      seriesName: ep.seriesName,
      label: ep.label,
      description: ep.description,
      tier: ep.tier,
      genre: ep.genre,
      rating: ep.rating,
      runtime: ep.runtime,
      contentType: ep.contentType,
      thumbnail: ep.thumbnail,
      releaseYear: ep.releaseYear
    };
  }
  if (seg.kind === 'media') {
    const m = mediaById[seg.mediaId];
    return { ...base, mediaId: m.id, title: m.title, thumbnail: m.thumbnail };
  }
  if (seg.kind === 'live_slot') return { ...base, title: seg.title };
  if (seg.kind === 'ad_break') return { ...base, title: seg.filler ? 'Ads & bumpers' : 'Ad break' };
  return { ...base, title: 'Off air' };
}

/* ---------------- "what's on right now" ---------------- */

// The snapshot every viewer polls. Never contains a playable URL — those
// come from /api/channel/play, one viewer at a time, only for what's airing.
export async function getChannelNow(channel, at = new Date()) {
  const { date, sec } = channelClock(at);
  const serverTime = at.toISOString();
  const tomorrow = addDays(date, 1);

  const live = await getCurrentLiveStream(channel.id);
  const days = await planChannelDays(channel, [date, tomorrow], { includeLive: false, at });
  const lineup = [];
  for (const s of [
    ...days[date].map((x) => ({ ...x, date })),
    ...days[tomorrow].map((x) => ({ ...x, date: tomorrow, start: x.start + DAY_SECONDS, end: x.end + DAY_SECONDS }))
  ]) {
    // Days are planned separately, so something still playing at midnight
    // arrives as two pieces. Join them, or the player would treat the
    // second half as a new program (and run an ad break mid-episode).
    const prev = lineup[lineup.length - 1];
    const continues = prev && prev.kind === s.kind && prev.end === s.start &&
      ((s.episodeId && prev.episodeId === s.episodeId) || (s.mediaId && prev.mediaId === s.mediaId)) &&
      Math.abs(s.startOffset - (prev.startOffset + (prev.end - prev.start))) < 1;
    if (continues) prev.end = s.end;
    else lineup.push(s);
  }
  const current = segmentAt(lineup, sec);
  const idx = lineup.indexOf(current);
  const next = lineup.slice(idx + 1)
    .filter((s) => s.kind !== 'ad_break')
    .slice(0, 3)
    .map((s) => ({ kind: s.kind, title: s.title, label: s.label || null, seriesName: s.seriesName || null, startsAt: new Date(channelSecToMs(date, s.start)).toISOString() }));

  const channelInfo = channelToPublic(channel);
  if (live) {
    return { onAir: true, serverTime, channelDate: date, channelSec: sec, channel: channelInfo, live, program: null, next };
  }
  if (!current || current.kind === 'off_air') {
    return { onAir: false, serverTime, channelDate: date, channelSec: sec, channel: channelInfo, live: null, program: null, next };
  }

  const offsetSeconds = current.startOffset + (sec - current.start);
  const durationSeconds = current.startOffset + (current.end - current.start);
  return {
    onAir: true,
    serverTime,
    // Channel time (Pacific) as of serverTime, so clients without reliable
    // time zone support (the mobile app) can label times themselves.
    channelDate: date,
    channelSec: sec,
    channel: channelInfo,
    live: null,
    // Ads run on channels for everyone, subscribers included.
    adsEnabled: true,
    program: {
      // Changes whenever a new segment starts, so the player knows to retune.
      key: `${current.date}:${current.start}:${current.kind}:${current.episodeId || current.mediaId || ''}`,
      kind: current.kind,
      episodeId: current.episodeId || null,
      mediaId: current.mediaId || null,
      title: current.title,
      seriesId: current.seriesId || null,
      seriesName: current.seriesName || null,
      label: current.label || null,
      description: current.description || null,
      tier: current.tier || null,
      genre: current.genre || null,
      rating: current.rating || null,
      runtime: current.runtime || null,
      contentType: current.contentType || null,
      releaseYear: current.releaseYear || null,
      thumbnail: current.thumbnail || null,
      layer: current.layer,
      offsetSeconds,
      durationSeconds,
      // lineup times count from today's midnight, so tomorrow's run past 86400
      endsAt: new Date(channelSecToMs(date, current.end)).toISOString()
    },
    next
  };
}

export { SERIES_KINDS };

