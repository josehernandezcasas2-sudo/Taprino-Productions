import { getSupabase } from './supabase';
import { loadEligibleContent, planChannelDays, channelClock } from './channelEngine';
import { addDays, weekStartOf, timeToSec, secToTime, SERIES_KINDS, DAY_SECONDS } from './channelPlan';

// Everything the channel scheduler (/schedule) reads and writes. API routes
// check canScheduleChannel() before calling in here; these functions still
// validate every rule themselves, so nothing depends on the UI behaving.

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SLOT_FIELDS = 'id, channel_id, layer, air_date, day_of_week, start_time, duration_seconds, kind, episode_id, media_id, series_id, pin_episode_id, rerun_of, title';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LIMITS = {
  series: { min: 5 * 60, max: 12 * 3600, label: 'between 5 minutes and 12 hours' },
  ad_break: { min: 30, max: 30 * 60, label: 'between 30 seconds and 30 minutes' },
  live: { min: 15 * 60, max: 6 * 3600, label: 'between 15 minutes and 6 hours' }
};

function fail(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

function clockLabel(sec) {
  const h24 = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/* ---------------- reading ---------------- */

export async function getChannelForScheduler(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channels').select('id, slug, name, number, visibility, loop_started_at').eq('id', channelId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// The library: everything opted in to channels that can air right now.
export async function getSchedulerLibrary() {
  const content = await loadEligibleContent();
  const series = Object.entries(content.seriesEpisodes).map(([id, eps]) => ({
    id,
    name: eps[0].seriesName || 'Untitled series',
    thumbnail: eps[0].thumbnail,
    contentType: eps[0].contentType,
    tiers: [...new Set(eps.map((e) => e.tier))],
    episodes: eps.map((e) => ({ id: e.id, title: e.title, label: e.label, durationSeconds: e.durationSeconds, tier: e.tier }))
  })).sort((a, b) => a.name.localeCompare(b.name));
  const titles = Object.values(content.episodesById)
    .filter((e) => !e.seriesId)
    .map((e) => ({ id: e.id, title: e.title, durationSeconds: e.durationSeconds, tier: e.tier, contentType: e.contentType, thumbnail: e.thumbnail }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { series, titles };
}

function describeSlot(s, content, mediaById = {}) {
  const ep = s.episode_id ? content.episodesById[s.episode_id] : null;
  const seriesEps = s.series_id ? content.seriesEpisodes[s.series_id] : null;
  let title = s.title || null;
  let unavailable = false;
  if (s.kind === 'episode') {
    title = ep ? (ep.seriesName ? `${ep.seriesName} · ${ep.label ? `${ep.label} ` : ''}${ep.title}` : ep.title) : 'Title no longer available';
    unavailable = !ep;
  } else if (SERIES_KINDS.includes(s.kind)) {
    title = seriesEps && seriesEps.length ? seriesEps[0].seriesName : 'Series no longer available';
    unavailable = !(seriesEps && seriesEps.length);
  } else if (s.kind === 'media') {
    const m = mediaById[s.media_id];
    title = m ? m.title : 'Upload no longer available';
    unavailable = !m || m.status !== 'approved' || m.moderation_hold;
  } else if (s.kind === 'ad_break') {
    title = 'Ad break';
  } else if (s.kind === 'live') {
    title = s.title || 'Live broadcast';
  }
  const pin = s.pin_episode_id && content.episodesById[s.pin_episode_id];
  return {
    id: s.id,
    layer: s.layer,
    airDate: s.air_date,
    dayOfWeek: s.day_of_week,
    start: timeToSec(s.start_time),
    durationSeconds: s.kind === 'episode' && ep ? ep.durationSeconds : s.duration_seconds,
    kind: s.kind,
    episodeId: s.episode_id,
    mediaId: s.media_id,
    seriesId: s.series_id,
    pinEpisodeId: s.pin_episode_id,
    pinLabel: pin ? (pin.label || pin.title) : null,
    rerunOf: s.rerun_of,
    title,
    tier: ep ? ep.tier : null,
    unavailable
  };
}

// One view of the scheduler: a week of dated slots, or the default
// (weekday) schedule. `preview` says which episodes each series block will
// actually play on its upcoming airings, straight from the engine.
export async function getScheduleView(channel, { layer, weekStart }) {
  const supabase = getSupabase();
  const today = channelClock().date;
  const content = await loadEligibleContent();

  let q = supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channel.id).eq('layer', layer);
  let published = null;
  if (layer === 'week') {
    if (!DATE_RE.test(weekStart || '') || weekStartOf(weekStart) !== weekStart) fail('weekStart must be a Monday (YYYY-MM-DD).');
    q = q.gte('air_date', weekStart).lte('air_date', addDays(weekStart, 6));
    const { data: wk, error: wkErr } = await supabase.from('channel_weeks').select('published_at').eq('channel_id', channel.id).eq('week_start', weekStart).maybeSingle();
    if (wkErr) throw new Error(wkErr.message);
    published = !!(wk && wk.published_at);
  }
  const { data: rows, error } = await q.order('start_time', { ascending: true });
  if (error) throw new Error(error.message);
  const mediaIds = [...new Set((rows || []).map((s) => s.media_id).filter(Boolean))];
  let mediaById = {};
  if (mediaIds.length) {
    const { data: media, error: mErr } = await supabase.from('channel_media').select('id, title, status, moderation_hold').in('id', mediaIds);
    if (mErr) throw new Error(mErr.message);
    mediaById = Object.fromEntries((media || []).map((m) => [m.id, m]));
  }
  const slots = (rows || []).map((s) => describeSlot(s, content, mediaById));

  // Preview the next two weeks of airings for series blocks.
  const preview = {};
  if (slots.some((s) => SERIES_KINDS.includes(s.kind))) {
    const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const days = await planChannelDays(channel, dates, { includeLive: true });
    for (const date of dates) {
      for (const seg of days[date]) {
        if (!seg.slotId || seg.kind !== 'episode' || !SERIES_KINDS.includes(seg.blockKind)) continue;
        const bySlot = (preview[seg.slotId] = preview[seg.slotId] || {});
        (bySlot[date] = bySlot[date] || []).push(seg.label || seg.title);
      }
    }
  }
  return { layer, weekStart: weekStart || null, published, today, slots, preview };
}

/* ---------------- writing ---------------- */

async function loadSlot(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_slots').select(SLOT_FIELDS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('That slot no longer exists.');
  return data;
}

async function sameDaySlots(channelId, layer, airDate, dayOfWeek) {
  const supabase = getSupabase();
  let q = supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channelId).eq('layer', layer);
  q = layer === 'week' ? q.eq('air_date', airDate) : q.eq('day_of_week', dayOfWeek);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

function parseStart(startTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime || '')) fail('Start time must look like 19:30.');
  const sec = timeToSec(`${startTime}:00`);
  if (sec < 0 || sec >= DAY_SECONDS) fail('Start time must be within the day.');
  return sec;
}

function withinLimit(kindKey, seconds) {
  const lim = LIMITS[kindKey];
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n) || n < lim.min || n > lim.max) fail(`That block has to be ${lim.label}.`);
  return n;
}

// Builds the full row for a slot from what the client sent, checking every
// rule along the way. `existing` is set when editing.
async function buildRow({ roleContext, channelId, body, existing, content }) {
  const layer = existing ? existing.layer : body.layer;
  if (!['week', 'default'].includes(layer)) fail('layer must be week or default.');
  const airDate = existing ? existing.air_date : body.airDate;
  const dayOfWeek = existing ? existing.day_of_week : body.dayOfWeek;
  if (layer === 'week' && !DATE_RE.test(airDate || '')) fail('Pick a date for this slot.');
  if (layer === 'default' && !DAYS.includes(dayOfWeek)) fail('Pick a day for this slot.');

  const kind = body.kind !== undefined ? body.kind : existing.kind;
  const start = body.startTime !== undefined ? parseStart(body.startTime) : timeToSec(existing.start_time);

  const row = {
    channel_id: channelId,
    layer,
    air_date: layer === 'week' ? airDate : null,
    day_of_week: layer === 'default' ? dayOfWeek : null,
    start_time: secToTime(start),
    kind,
    episode_id: null,
    media_id: null,
    series_id: null,
    pin_episode_id: null,
    rerun_of: null,
    title: null
  };
  const pick = (key, existingKey) => (body[key] !== undefined ? body[key] : existing ? existing[existingKey] : undefined);

  if (kind === 'episode') {
    const id = pick('episodeId', 'episode_id');
    const ep = content.episodesById[id];
    if (!ep) fail("That title isn't available for channels (it has to be published and opted in by its creator).");
    row.episode_id = id;
    row.duration_seconds = ep.durationSeconds;
  } else if (SERIES_KINDS.includes(kind)) {
    const seriesId = pick('seriesId', 'series_id');
    const eps = content.seriesEpisodes[seriesId];
    if (!eps || !eps.length) fail("That series has no episodes available for channels yet.");
    row.series_id = seriesId;
    row.duration_seconds = withinLimit('series', pick('durationSeconds', 'duration_seconds'));
    if (kind === 'series_continue' && layer !== 'default') {
      fail('Continue blocks pick up where they left off day to day, so they belong in the default schedule. Use Pinned for a one-off week.');
    }
    if (kind === 'series_pinned') {
      const pin = pick('pinEpisodeId', 'pin_episode_id') || eps[0].id;
      if (!eps.some((e) => e.id === pin)) fail("That episode isn't part of this series.");
      row.pin_episode_id = pin;
    }
    if (kind === 'series_rerun') {
      const srcId = pick('rerunOf', 'rerun_of');
      if (!srcId) fail('Pick the block this one reruns.');
      const src = await loadSlot(srcId);
      const sameDay = src.channel_id === channelId && src.layer === layer && src.air_date === row.air_date && src.day_of_week === row.day_of_week;
      if (!sameDay || !SERIES_KINDS.includes(src.kind) || src.kind === 'series_rerun') fail('A rerun has to copy a Continue or Pinned block from earlier the same day.');
      if (src.series_id !== seriesId) fail('A rerun has to be the same series as the block it copies.');
      if (timeToSec(src.start_time) >= start) fail('A rerun has to start after the block it copies.');
      row.rerun_of = srcId;
    }
  } else if (kind === 'ad_break') {
    row.duration_seconds = withinLimit('ad_break', pick('durationSeconds', 'duration_seconds'));
  } else if (kind === 'live') {
    if (!roleContext.isAdmin) fail('Only admins can schedule live broadcasts.');
    row.duration_seconds = withinLimit('live', pick('durationSeconds', 'duration_seconds'));
    const title = String(pick('title', 'title') || '').trim();
    if (!title) fail('Give the live broadcast a title for the guide.');
    row.title = title.slice(0, 80);
  } else if (kind === 'media') {
    const mediaId = pick('mediaId', 'media_id');
    const { data: m, error: mErr } = await getSupabase().from('channel_media').select('id, owner_id, status, moderation_hold, duration_seconds').eq('id', mediaId || '').maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!m) fail('That upload no longer exists.');
    if (!roleContext.isAdmin && m.owner_id !== roleContext.userId) fail('You can only schedule your own uploads.');
    if (m.status !== 'approved' || m.moderation_hold) fail("That upload hasn't been approved yet.");
    if (!m.duration_seconds) fail('That upload is still processing.');
    row.media_id = m.id;
    row.duration_seconds = m.duration_seconds;
  } else {
    fail('Unknown slot type.');
  }

  if (start + row.duration_seconds > DAY_SECONDS) {
    fail(`That runs past midnight (it would end at ${clockLabel(start + row.duration_seconds)}). Start it earlier, or put the rest on the next day.`);
  }

  // No two slots on the same day may overlap.
  const others = (await sameDaySlots(channelId, layer, row.air_date, row.day_of_week)).filter((s) => !existing || s.id !== existing.id);
  for (const o of others) {
    const oStart = timeToSec(o.start_time);
    const oDur = o.kind === 'episode' && content.episodesById[o.episode_id] ? content.episodesById[o.episode_id].durationSeconds : o.duration_seconds;
    if (start < oStart + oDur && oStart < start + row.duration_seconds) {
      fail(`That overlaps what's already on at ${clockLabel(oStart)}–${clockLabel(oStart + oDur)}.`);
    }
  }
  // A block that other blocks rerun can't move after them.
  if (existing) {
    const reruns = others.filter((o) => o.rerun_of === existing.id);
    if (reruns.some((r) => timeToSec(r.start_time) <= start)) fail('A rerun of this block airs earlier than that. Move or remove the rerun first.');
  }
  return row;
}

export async function createSlot(roleContext, channelId, body) {
  const content = await loadEligibleContent();
  const row = await buildRow({ roleContext, channelId, body, existing: null, content });
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_slots').insert({ ...row, created_by: roleContext.userId }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function updateSlot(roleContext, channelId, id, body) {
  const existing = await loadSlot(id);
  if (existing.channel_id !== channelId) fail('That slot belongs to a different channel.');
  if (existing.kind === 'live' && !roleContext.isAdmin) fail('Only admins can change live broadcast slots.');
  const content = await loadEligibleContent();
  const row = await buildRow({ roleContext, channelId, body, existing, content });
  const supabase = getSupabase();
  const { error } = await supabase.from('channel_slots').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  // A Continue block that now shows a different series starts that series over.
  if (existing.kind === 'series_continue' && (row.kind !== 'series_continue' || row.series_id !== existing.series_id)) {
    await supabase.from('channel_block_progress').delete().eq('slot_id', id);
  }
}

// Reruns of a deleted block go with it (foreign key cascade).
export async function deleteSlot(roleContext, channelId, id) {
  const existing = await loadSlot(id);
  if (existing.channel_id !== channelId) fail('That slot belongs to a different channel.');
  if (existing.kind === 'live' && !roleContext.isAdmin) fail('Only admins can remove live broadcast slots.');
  const { error } = await getSupabase().from('channel_slots').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Sets a Continue block's bookmark back to the first episode.
export async function resetBookmark(channelId, id) {
  const existing = await loadSlot(id);
  if (existing.channel_id !== channelId || existing.kind !== 'series_continue') fail('Only Continue blocks have a bookmark.');
  const { error } = await getSupabase().from('channel_block_progress').delete().eq('slot_id', id);
  if (error) throw new Error(error.message);
}

// Copies one day's lineup onto other days in the same view, replacing what
// those days had. Live slots are only copied by admins. Each copy of a
// Continue block keeps its own bookmark.
export async function copyDay(roleContext, channelId, { layer, from, to }) {
  if (!['week', 'default'].includes(layer)) fail('layer must be week or default.');
  const valid = (d) => (layer === 'week' ? DATE_RE.test(d || '') : DAYS.includes(d));
  if (!valid(from) || !Array.isArray(to) || !to.length || !to.every(valid)) fail('Pick a day to copy and at least one day to copy it to.');
  const targets = [...new Set(to)].filter((d) => d !== from);
  const supabase = getSupabase();
  const source = (await sameDaySlots(channelId, layer, layer === 'week' ? from : null, layer === 'default' ? from : null))
    .filter((s) => s.kind !== 'live' || roleContext.isAdmin);

  for (const target of targets) {
    let del = supabase.from('channel_slots').delete().eq('channel_id', channelId).eq('layer', layer);
    del = layer === 'week' ? del.eq('air_date', target) : del.eq('day_of_week', target);
    if (!roleContext.isAdmin) del = del.neq('kind', 'live');
    const { error: delErr } = await del;
    if (delErr) throw new Error(delErr.message);

    const base = (s) => ({
      channel_id: channelId, layer,
      air_date: layer === 'week' ? target : null,
      day_of_week: layer === 'default' ? target : null,
      start_time: s.start_time, duration_seconds: s.duration_seconds, kind: s.kind,
      episode_id: s.episode_id, media_id: s.media_id, series_id: s.series_id,
      pin_episode_id: s.pin_episode_id, title: s.title, created_by: roleContext.userId
    });
    const idMap = {};
    for (const s of source.filter((x) => x.kind !== 'series_rerun')) {
      const { data, error } = await supabase.from('channel_slots').insert(base(s)).select('id').single();
      if (error) throw new Error(error.message);
      idMap[s.id] = data.id;
    }
    for (const s of source.filter((x) => x.kind === 'series_rerun' && idMap[x.rerun_of])) {
      const { error } = await supabase.from('channel_slots').insert({ ...base(s), rerun_of: idMap[s.rerun_of] });
      if (error) throw new Error(error.message);
    }
  }
  return { copiedTo: targets.length };
}

export async function setWeekPublished(roleContext, channelId, weekStart, published) {
  if (!DATE_RE.test(weekStart || '') || weekStartOf(weekStart) !== weekStart) fail('weekStart must be a Monday.');
  const { error } = await getSupabase().from('channel_weeks').upsert({
    channel_id: channelId,
    week_start: weekStart,
    published_at: published ? new Date().toISOString() : null,
    published_by: published ? roleContext.userId : null
  }, { onConflict: 'channel_id,week_start' });
  if (error) throw new Error(error.message);
}

