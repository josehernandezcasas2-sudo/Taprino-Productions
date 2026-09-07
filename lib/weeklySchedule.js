import { getSupabase } from './supabase';
import { parseRuntimeToSeconds } from './videoMetadata';
import { getChannelState } from './channelSchedule';

// Fixed for every viewer, like a real broadcast schedule — see the
// comment on the migration for why this isn't converted per-viewer.
export const CHANNEL_TIMEZONE = 'America/Los_Angeles';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const EPISODE_FIELDS = 'id, title, tier, status, runtime, genre, artist, thumbnail, poster';

function timeToSeconds(timeStr) {
  // Postgres `time` columns come back as "HH:MM:SS".
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function secondsToTimeLabel(totalSeconds) {
  const wrapped = ((totalSeconds % 86400) + 86400) % 86400;
  const h24 = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Returns { dayOfWeek, secondsSinceMidnight } for right now, in the fixed
// channel timezone — this is what makes "what's on now" correct
// regardless of what timezone the server itself happens to run in.
function nowInChannelTimezone() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHANNEL_TIMEZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const dayOfWeek = map.weekday.toLowerCase();
  // "24" shows up at midnight with hour12: false in some environments —
  // normalize it to 0 rather than let it silently overflow the day.
  const hour = Number(map.hour) % 24;
  const seconds = hour * 3600 + Number(map.minute) * 60 + Number(map.second);
  return { dayOfWeek, secondsSinceMidnight: seconds };
}

async function fetchDaySlots(dayOfWeek) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('weekly_schedule_slots')
    .select(`id, day_of_week, start_time, slot_type, ad_duration_seconds, episode:episodes(${EPISODE_FIELDS})`)
    .eq('day_of_week', dayOfWeek)
    .order('start_time', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function durationSecondsFor(slot) {
  if (slot.slot_type === 'ad_break') return slot.ad_duration_seconds;
  return slot.episode ? parseRuntimeToSeconds(slot.episode.runtime) || 0 : 0;
}

// Full week, grouped by day, each slot carrying a computed end time (start
// of the next slot, or start + own duration for the day's last slot) —
// there's no stored end_time column, since a stored one would drift out
// of sync the moment an episode's runtime changed after being scheduled.
export async function listWeeklySchedule() {
  const result = {};
  for (const day of DAYS) {
    const slots = await fetchDaySlots(day);
    result[day] = slots.map((slot, i) => {
      const startSeconds = timeToSeconds(slot.start_time);
      const duration = durationSecondsFor(slot);
      const next = slots[i + 1];
      const endSeconds = next ? timeToSeconds(next.start_time) : startSeconds + duration;
      return {
        id: slot.id,
        dayOfWeek: slot.day_of_week,
        slotType: slot.slot_type,
        startTime: slot.start_time,
        startLabel: secondsToTimeLabel(startSeconds),
        endLabel: secondsToTimeLabel(endSeconds),
        durationSeconds: duration,
        gapAfterSeconds: next ? Math.max(0, timeToSeconds(next.start_time) - (startSeconds + duration)) : null,
        episode: slot.episode || null,
        adDurationSeconds: slot.ad_duration_seconds
      };
    });
  }
  return result;
}

// Same shape as listWeeklySchedule but for one day — this is what the
// public Channel page's schedule section reads from directly, since it
// only ever shows one day at a time.
export async function getScheduleForDay(dayOfWeek) {
  const full = await listWeeklySchedule();
  return full[dayOfWeek] || [];
}

export async function addSlot({ dayOfWeek, startTime, slotType, episodeId, adDurationSeconds }) {
  if (!DAYS.includes(dayOfWeek)) throw new Error('Invalid day of week.');
  if (!/^\d{2}:\d{2}$/.test(startTime)) throw new Error('Start time must be in HH:MM format.');
  const supabase = getSupabase();

  let episode = null;
  let duration;
  if (slotType === 'episode') {
    if (!episodeId) throw new Error('Choose an episode for this slot.');
    const { data, error } = await supabase.from('episodes').select(EPISODE_FIELDS).eq('id', episodeId).maybeSingle();
    if (error || !data) throw new Error('That episode could not be found.');
    if (data.status !== 'approved') throw new Error('Only published episodes can be scheduled.');
    // Same free-tier-only rule as the existing loop — see
    // lib/channelSchedule.js for why this is enforced here too, not just
    // filtered in whatever admin UI calls this.
    if (data.tier !== 'free') throw new Error('Only free-tier episodes can go on the channel schedule.');
    duration = parseRuntimeToSeconds(data.runtime);
    if (!duration) {
      throw new Error(`"${data.title}"'s runtime ("${data.runtime || 'not set'}") isn't in a recognizable format — fix it on the episode first.`);
    }
    episode = data;
  } else if (slotType === 'ad_break') {
    if (!adDurationSeconds || adDurationSeconds <= 0) throw new Error('Ad break needs a duration in seconds.');
    duration = adDurationSeconds;
  } else {
    throw new Error('slotType must be "episode" or "ad_break".');
  }

  // Overlap check — this is the one thing that makes an explicit-time
  // schedule fundamentally different (and more fragile) than the
  // existing loop, which can never overlap with itself by construction.
  // Two slots covering the same moment would make "what's on now" (and
  // the public schedule display) ambiguous, so this is enforced here
  // rather than left as a UI-only convention an API caller could bypass.
  const existing = await fetchDaySlots(dayOfWeek);
  const newStart = timeToSeconds(`${startTime}:00`);
  const newEnd = newStart + duration;
  for (const slot of existing) {
    const slotStart = timeToSeconds(slot.start_time);
    const slotEnd = slotStart + durationSecondsFor(slot);
    if (newStart < slotEnd && slotStart < newEnd) {
      throw new Error(`That overlaps the ${slot.slot_type === 'ad_break' ? 'ad break' : (slot.episode ? slot.episode.title : 'existing item')} already scheduled at ${secondsToTimeLabel(slotStart)}.`);
    }
  }

  const { error: insertError } = await supabase.from('weekly_schedule_slots').insert({
    day_of_week: dayOfWeek,
    start_time: `${startTime}:00`,
    slot_type: slotType,
    episode_id: slotType === 'episode' ? episodeId : null,
    ad_duration_seconds: slotType === 'ad_break' ? adDurationSeconds : null
  });
  if (insertError) throw new Error(insertError.message);
  return { ok: true };
}

export async function removeSlot(slotId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('weekly_schedule_slots').delete().eq('id', slotId);
  if (error) throw new Error(error.message);
}

// Copies every slot from one day to another, replacing whatever was on
// the target day. Built specifically because a 7-day schedule built one
// slot at a time would be tedious — most channels realistically repeat
// the same lineup on several days (e.g. a weekday block, a weekend block)
// rather than having 7 genuinely distinct days.
export async function copyDaySchedule(fromDay, toDay) {
  if (!DAYS.includes(fromDay) || !DAYS.includes(toDay)) throw new Error('Invalid day of week.');
  if (fromDay === toDay) throw new Error('Source and target day are the same.');
  const supabase = getSupabase();
  const sourceSlots = await fetchDaySlots(fromDay);

  const { error: deleteError } = await supabase.from('weekly_schedule_slots').delete().eq('day_of_week', toDay);
  if (deleteError) throw new Error(deleteError.message);

  if (sourceSlots.length === 0) return { copied: 0 };

  const rows = sourceSlots.map((slot) => ({
    day_of_week: toDay,
    start_time: slot.start_time,
    slot_type: slot.slot_type,
    episode_id: slot.slot_type === 'episode' ? (slot.episode ? slot.episode.id : null) : null,
    ad_duration_seconds: slot.ad_duration_seconds
  }));
  const { error: insertError } = await supabase.from('weekly_schedule_slots').insert(rows);
  if (insertError) throw new Error(insertError.message);
  return { copied: rows.length };
}

// The public-facing "what's actually on right now" lookup. Checks the
// explicit weekly schedule first; any moment with no slot scheduled falls
// back to the existing loop, so an incompletely-built-out week never
// results in a dead channel — it just means some hours show loop content
// instead of hand-scheduled content, which is a much better failure mode
// than silence.
export async function getCurrentChannelProgram() {
  const { dayOfWeek, secondsSinceMidnight } = nowInChannelTimezone();
  const daySlots = await fetchDaySlots(dayOfWeek);

  for (let i = 0; i < daySlots.length; i++) {
    const slot = daySlots[i];
    const start = timeToSeconds(slot.start_time);
    const duration = durationSecondsFor(slot);
    const end = start + duration;
    if (secondsSinceMidnight >= start && secondsSinceMidnight < end) {
      return {
        source: 'weekly_schedule',
        slotId: slot.id,
        slotType: slot.slot_type,
        episode: slot.episode || null,
        elapsedSeconds: secondsSinceMidnight - start,
        durationSeconds: duration
      };
    }
  }

  // No explicit slot covers this moment — fall back to the loop. The
  // loop's own shape spreads episode fields directly into `.program`
  // (episode fields are flat properties there, not a separate `.episode`
  // sub-object) — remapped here so every caller of this function can read
  // `.episode` regardless of which source actually served it, rather than
  // needing two different code paths depending on where the program
  // came from.
  const loopState = await getChannelState();
  return {
    source: 'loop',
    onAir: loopState.onAir,
    episode: loopState.onAir ? loopState.program : null,
    elapsedSeconds: loopState.onAir ? loopState.program.offsetSeconds : null,
    durationSeconds: loopState.onAir ? loopState.program.durationSeconds : null,
    next: loopState.next || null
  };
}
