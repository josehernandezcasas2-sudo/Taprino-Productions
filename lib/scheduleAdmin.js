import { getSupabase } from './supabase';
import { loadEligibleContent, planChannelDays, channelClock } from './channelEngine';
import { addDays, weekStartOf, timeToSec, secToTime, wholeMinutes, SERIES_KINDS, DAY_SECONDS } from './channelPlan';
import { LENGTH_LIMITS, overlaps, isHard, rerunProblem } from './scheduleLayout';

// Everything the channel scheduler (/schedule) reads and writes. API routes
// check canScheduleChannel() before calling in here; these functions still
// validate every rule themselves, so nothing depends on the UI behaving.
//
// The scheduler edits a draft in the browser and saves whole days at once
// (saveDays), so a drag that also shuffles an ad break is one change that
// either lands completely or not at all.

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SLOT_FIELDS = 'id, channel_id, layer, air_date, day_of_week, start_time, duration_seconds, kind, episode_id, media_id, series_id, pin_episode_id, rerun_of, title';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// New slots arrive from the browser with ids like "tmp-3"; real ids are UUIDs.
const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');

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

// Shows and uploads take whole minutes; the seconds left over are ads.
function slotLength(s, content, mediaById) {
  if (s.kind === 'episode' && content.episodesById[s.episode_id]) return wholeMinutes(content.episodesById[s.episode_id].durationSeconds);
  if (s.kind === 'media' && mediaById[s.media_id] && mediaById[s.media_id].duration_seconds) return wholeMinutes(mediaById[s.media_id].duration_seconds);
  return s.duration_seconds;
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
    durationSeconds: slotLength(s, content, mediaById),
    runtimeSeconds: ep ? ep.durationSeconds : s.kind === 'media' && mediaById[s.media_id] ? mediaById[s.media_id].duration_seconds : null,
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

async function loadMediaById(ids) {
  const mediaIds = [...new Set(ids.filter(Boolean))];
  if (!mediaIds.length) return {};
  const { data, error } = await getSupabase().from('channel_media').select('id, owner_id, title, status, moderation_hold, duration_seconds').in('id', mediaIds);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((m) => [m.id, m]));
}

// One view of the scheduler: a week of dated slots, or the default
// (weekday) schedule. The week view also carries the default schedule
// (`defaults`, by weekday) so the page can show what fills the open time.
// `preview` says which episodes each series block will actually play on
// its upcoming airings, straight from the engine.
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
  let defaultRows = [];
  if (layer === 'week') {
    const { data: dr, error: dErr } = await supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channel.id).eq('layer', 'default').order('start_time', { ascending: true });
    if (dErr) throw new Error(dErr.message);
    defaultRows = dr || [];
  }
  const mediaById = await loadMediaById([...(rows || []), ...defaultRows].map((s) => s.media_id));
  const slots = (rows || []).map((s) => describeSlot(s, content, mediaById));
  const defaults = {};
  for (const s of defaultRows) (defaults[s.day_of_week] = defaults[s.day_of_week] || []).push(describeSlot(s, content, mediaById));

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
  return { layer, weekStart: weekStart || null, published, today, slots, defaults, preview };
}

/* ---------------- writing ---------------- */

async function loadSlot(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_slots').select(SLOT_FIELDS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail('That slot no longer exists.');
  return data;
}

function withinLimit(kindKey, seconds) {
  const lim = LENGTH_LIMITS[kindKey];
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n) || n < lim.min || n > lim.max) fail(`That block has to be ${lim.label}.`);
  return n;
}

// Turns one slot from the browser into a database row, checking every rule
// that concerns the slot on its own. Day-wide rules (overlaps, rerun order)
// are checked in saveDays once the whole day is known.
function buildRow({ roleContext, channelId, layer, dayKey, slot, existing, content, mediaById }) {
  const kind = slot.kind;
  const start = Math.round(Number(slot.start));
  if (!Number.isFinite(start) || start < 0 || start >= DAY_SECONDS || start % 60 !== 0) fail('Start times are whole minutes within the day.');
  const name = slot.title || kind;

  const row = {
    channel_id: channelId,
    layer,
    air_date: layer === 'week' ? dayKey : null,
    day_of_week: layer === 'default' ? dayKey : null,
    start_time: secToTime(start),
    kind,
    episode_id: null,
    media_id: null,
    series_id: null,
    pin_episode_id: null,
    rerun_of: null,
    title: null
  };

  if (kind === 'episode') {
    const ep = content.episodesById[slot.episodeId];
    if (!ep) fail(`${slot.title || 'That title'} isn't available for channels (it has to be published and opted in by its creator).`);
    row.episode_id = ep.id;
    row.duration_seconds = wholeMinutes(ep.durationSeconds);
  } else if (SERIES_KINDS.includes(kind)) {
    const eps = content.seriesEpisodes[slot.seriesId];
    if (!eps || !eps.length) fail(`${slot.title || 'That series'} has no episodes available for channels.`);
    row.series_id = slot.seriesId;
    row.duration_seconds = wholeMinutes(withinLimit('series', slot.durationSeconds));
    if (kind === 'series_continue' && layer !== 'default') {
      fail('Continue blocks pick up where they left off day to day, so they belong in the default schedule. Use Pinned for a one-off week.');
    }
    if (kind === 'series_pinned') {
      const pin = slot.pinEpisodeId || eps[0].id;
      if (!eps.some((e) => e.id === pin)) fail(`That episode isn't part of ${eps[0].seriesName || 'the series'}.`);
      row.pin_episode_id = pin;
    }
    if (kind === 'series_rerun') {
      if (!slot.rerunOf) fail('Pick the block this one reruns.');
      row.rerun_of = slot.rerunOf; // checked against the day in saveDays
    }
  } else if (kind === 'ad_break') {
    row.duration_seconds = withinLimit('ad_break', slot.durationSeconds);
  } else if (kind === 'live') {
    if (!roleContext.isAdmin && !existing) fail('Only admins can schedule live broadcasts.');
    row.duration_seconds = wholeMinutes(withinLimit('live', slot.durationSeconds));
    const title = String(slot.title || '').trim();
    if (!title) fail('Give the live broadcast a title for the guide.');
    row.title = title.slice(0, 80);
  } else if (kind === 'media') {
    const m = mediaById[slot.mediaId];
    if (!m) fail(`${name === 'media' ? 'That upload' : name} no longer exists.`);
    if (!roleContext.isAdmin && m.owner_id !== roleContext.userId) fail('You can only schedule your own uploads.');
    if (m.status !== 'approved' || m.moderation_hold) fail(`${m.title} hasn't been approved yet.`);
    if (!m.duration_seconds) fail(`${m.title} is still processing.`);
    row.media_id = m.id;
    row.duration_seconds = wholeMinutes(m.duration_seconds);
  } else {
    fail('Unknown slot type.');
  }

  if (start + row.duration_seconds > DAY_SECONDS) {
    fail(`${slot.title || 'A block'} runs past midnight (it would end at ${clockLabel(start + row.duration_seconds)}). Start it earlier, or put the rest on the next day.`);
  }
  return row;
}

const sameRow = (a, b) => ['start_time', 'duration_seconds', 'kind', 'episode_id', 'media_id', 'series_id', 'pin_episode_id', 'rerun_of', 'title', 'air_date', 'day_of_week']
  .every((k) => (a[k] ?? null) === (b[k] ?? null));

// Saves whole days: `days` maps a day (YYYY-MM-DD for the week layer, a
// weekday name for the default layer) to the complete list of slots that
// day should have. Slots keep their ids; new ones carry a "tmp-" id, which
// other slots (reruns) may refer to. Anything on those days that isn't in
// the list is deleted. The finished picture is checked before anything is
// written. Returns { ids: { tmpId: realId } }.
export async function saveDays(roleContext, channelId, { layer, days }) {
  if (!['week', 'default'].includes(layer)) fail('layer must be week or default.');
  const keys = Object.keys(days || {});
  if (!keys.length) fail('Nothing to save.');
  if (keys.length > 7) fail('Save one week at a time.');
  for (const k of keys) {
    if (layer === 'week' ? !DATE_RE.test(k) : !DAYS.includes(k)) fail(`"${k}" isn't a day this view can save.`);
    if (!Array.isArray(days[k]) || days[k].length > 200) fail(`The list for ${k} isn't right.`);
  }
  if (layer === 'week') {
    const ws = weekStartOf(keys[0]);
    if (keys.some((k) => weekStartOf(k) !== ws)) fail('Save one week at a time.');
  }

  const supabase = getSupabase();
  const content = await loadEligibleContent();
  let q = supabase.from('channel_slots').select(SLOT_FIELDS).eq('channel_id', channelId).eq('layer', layer);
  q = layer === 'week' ? q.in('air_date', keys) : q.in('day_of_week', keys);
  const { data: existingRows, error } = await q;
  if (error) throw new Error(error.message);
  const existingById = Object.fromEntries((existingRows || []).map((r) => [r.id, r]));
  const mediaById = await loadMediaById(keys.flatMap((k) => days[k].map((s) => s.mediaId)));

  // Build every row, then check each day as a whole.
  const plan = []; // { key, slot, row, existing }
  const seen = new Set();
  for (const key of keys) {
    for (const slot of days[key]) {
      if (!slot || typeof slot !== 'object') fail('A slot is missing.');
      const existing = !isTempId(slot.id) ? existingById[slot.id] : null;
      if (!isTempId(slot.id) && !existing) fail(`${slot.title || 'A slot'} isn't on this schedule anymore. Reload and try again.`);
      if (seen.has(slot.id)) fail(`${slot.title || 'A slot'} is listed twice.`);
      seen.add(slot.id);
      if (existing && existing.kind === 'live' && !roleContext.isAdmin && slot.kind !== 'live') fail('Only admins can change live broadcast slots.');
      const row = buildRow({ roleContext, channelId, layer, dayKey: key, slot, existing, content, mediaById });
      if (existing && existing.kind === 'live' && !roleContext.isAdmin && !sameRow(row, existing)) fail('Only admins can change live broadcast slots.');
      plan.push({ key, slot, row, existing });
    }
    const daySlots = plan.filter((p) => p.key === key).map((p) => ({
      id: p.slot.id, kind: p.row.kind, start: timeToSec(p.row.start_time), durationSeconds: p.row.duration_seconds, rerunOf: p.row.rerun_of, seriesId: p.row.series_id, title: p.slot.title
    }));
    for (const s of daySlots) {
      const hit = daySlots.find((o) => o.id !== s.id && (isHard(o) || !isHard(s)) && overlaps(o, s));
      if (hit) fail(`${s.title || 'A block'} overlaps ${hit.title || 'another block'} (${clockLabel(hit.start)}–${clockLabel(hit.start + hit.durationSeconds)}) on ${layer === 'week' ? key : key[0].toUpperCase() + key.slice(1)}.`);
      if (s.kind === 'series_rerun') {
        const src = daySlots.find((o) => o.id === s.rerunOf);
        if (!src || !SERIES_KINDS.includes(src.kind) || src.kind === 'series_rerun') fail('A rerun has to copy a Continue or Pinned block from earlier the same day.');
        if (src.seriesId !== s.seriesId) fail('A rerun has to be the same series as the block it copies.');
      }
      const problem = rerunProblem(daySlots, s.id);
      if (problem) fail(problem);
    }
  }
  const deletions = (existingRows || []).filter((r) => !seen.has(r.id));
  if (!roleContext.isAdmin && deletions.some((r) => r.kind === 'live')) fail('Only admins can remove live broadcast slots.');

  // Write: deletions, then updates, then new rows (reruns last, so the
  // blocks they point at already have real ids).
  if (deletions.length) {
    const { error: delErr } = await supabase.from('channel_slots').delete().in('id', deletions.map((r) => r.id));
    if (delErr) throw new Error(delErr.message);
  }
  const ids = {};
  const realId = (id) => (isTempId(id) ? ids[id] : id);
  const updates = plan.filter((p) => p.existing && !sameRow(p.row, p.existing));
  const inserts = plan.filter((p) => !p.existing);
  for (const p of updates.filter((u) => u.row.kind !== 'series_rerun')) {
    const { error: upErr } = await supabase.from('channel_slots').update({ ...p.row, updated_at: new Date().toISOString() }).eq('id', p.existing.id);
    if (upErr) throw new Error(upErr.message);
  }
  for (const p of inserts.filter((i) => i.row.kind !== 'series_rerun')) {
    const { data, error: insErr } = await supabase.from('channel_slots').insert({ ...p.row, created_by: roleContext.userId }).select('id').single();
    if (insErr) throw new Error(insErr.message);
    ids[p.slot.id] = data.id;
  }
  for (const p of updates.filter((u) => u.row.kind === 'series_rerun')) {
    const { error: upErr } = await supabase.from('channel_slots').update({ ...p.row, rerun_of: realId(p.row.rerun_of), updated_at: new Date().toISOString() }).eq('id', p.existing.id);
    if (upErr) throw new Error(upErr.message);
  }
  for (const p of inserts.filter((i) => i.row.kind === 'series_rerun')) {
    const { data, error: insErr } = await supabase.from('channel_slots').insert({ ...p.row, rerun_of: realId(p.row.rerun_of), created_by: roleContext.userId }).select('id').single();
    if (insErr) throw new Error(insErr.message);
    ids[p.slot.id] = data.id;
  }
  // A Continue block that now shows a different series starts that series over.
  const restart = updates.filter((p) => p.existing.kind === 'series_continue' && (p.row.kind !== 'series_continue' || p.row.series_id !== p.existing.series_id)).map((p) => p.existing.id);
  if (restart.length) {
    const { error: prErr } = await supabase.from('channel_block_progress').delete().in('slot_id', restart);
    if (prErr) throw new Error(prErr.message);
  }
  return { ids, deleted: deletions.length, updated: updates.length, added: inserts.length };
}

// Sets a Continue block's bookmark back to the first episode.
export async function resetBookmark(channelId, id) {
  const existing = await loadSlot(id);
  if (existing.channel_id !== channelId || existing.kind !== 'series_continue') fail('Only Continue blocks have a bookmark.');
  const { error } = await getSupabase().from('channel_block_progress').delete().eq('slot_id', id);
  if (error) throw new Error(error.message);
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
