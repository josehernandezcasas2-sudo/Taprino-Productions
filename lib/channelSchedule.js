import { getSupabase } from './supabase';
import { parseRuntimeToSeconds } from './videoMetadata';

const EPISODE_FIELDS = 'id, title, description, tier, genre, artist, runtime, video_type, src, poster, thumbnail';

/* ===================================================================
   Admin-facing CRUD
   =================================================================== */

export async function listChannelSchedule() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('channel_schedule')
    .select(`id, position, duration_seconds, episode:episodes(${EPISODE_FIELDS})`)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getChannelSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  // The migration seeds this row, but fall back gracefully rather than
  // throw if it's ever missing — an empty/default channel is a much
  // better failure mode than a broken admin page.
  return data || { id: 1, loop_started_at: new Date().toISOString(), ads_enabled: true };
}

// Appends an episode to the end of the loop. Free-tier only — a real,
// enforced constraint, not just a UI convention: a scheduled premium
// episode would either need per-viewer entitlement checks baked into the
// channel (real complexity this v1 doesn't take on) or would leak premium
// video to anyone who tunes into the channel, and neither is acceptable.
export async function addEpisodeToSchedule(episodeId) {
  const supabase = getSupabase();

  const { data: episode, error: epError } = await supabase
    .from('episodes')
    .select('id, title, tier, status, runtime')
    .eq('id', episodeId)
    .maybeSingle();
  if (epError || !episode) throw new Error('That episode could not be found.');
  if (episode.status !== 'approved') throw new Error('Only published episodes can go on the channel.');
  if (episode.tier !== 'free') throw new Error('Only free-tier episodes can go on the channel — Studio Tapa + content stays behind the paywall everywhere, including here.');

  const durationSeconds = parseRuntimeToSeconds(episode.runtime);
  if (!durationSeconds) {
    throw new Error(`"${episode.title}"'s runtime ("${episode.runtime || 'not set'}") isn't in a recognizable mm:ss format — fix it on the episode itself first, since the channel needs a real duration to schedule around.`);
  }

  const { data: existing, error: existingError } = await supabase.from('channel_schedule').select('id').eq('episode_id', episodeId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error('That episode is already on the schedule.');

  const { count, error: countError } = await supabase.from('channel_schedule').select('id', { count: 'exact', head: true });
  if (countError) throw new Error(countError.message);

  const { error: insertError } = await supabase.from('channel_schedule').insert({
    position: count || 0,
    episode_id: episodeId,
    duration_seconds: durationSeconds
  });
  if (insertError) throw new Error(insertError.message);
}

export async function removeFromSchedule(rowId) {
  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase.from('channel_schedule').select('position').eq('id', rowId).maybeSingle();
  if (fetchError || !row) throw new Error('That schedule entry no longer exists.');

  const { error: deleteError } = await supabase.from('channel_schedule').delete().eq('id', rowId);
  if (deleteError) throw new Error(deleteError.message);

  // Close the gap so positions stay contiguous from 0 — the loop math
  // depends on that, not on positions merely being in ascending order.
  const { data: after, error: afterError } = await supabase
    .from('channel_schedule')
    .select('id, position')
    .gt('position', row.position)
    .order('position', { ascending: true });
  if (afterError) throw new Error(afterError.message);

  for (const r of after || []) {
    await supabase.from('channel_schedule').update({ position: r.position - 1 }).eq('id', r.id);
  }
}

// Swaps a row with its neighbor. Simple up/down reordering, matching the
// pattern already used for hero rotation elsewhere in the admin — no need
// for drag-and-drop machinery for a list that's realistically a handful
// to a few dozen items.
export async function moveScheduleItem(rowId, direction) {
  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase.from('channel_schedule').select('id, position').eq('id', rowId).maybeSingle();
  if (fetchError || !row) throw new Error('That schedule entry no longer exists.');

  const neighborPosition = direction === 'up' ? row.position - 1 : row.position + 1;
  const { data: neighbor, error: neighborError } = await supabase
    .from('channel_schedule')
    .select('id, position')
    .eq('position', neighborPosition)
    .maybeSingle();
  if (neighborError) throw new Error(neighborError.message);
  if (!neighbor) return; // already at the top/bottom — nothing to do

  await supabase.from('channel_schedule').update({ position: row.position }).eq('id', neighbor.id);
  await supabase.from('channel_schedule').update({ position: neighbor.position }).eq('id', row.id);
}

export async function updateChannelAdsEnabled(adsEnabled) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('channel_settings')
    .update({ ads_enabled: adsEnabled, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(error.message);
}

// Restarts the loop from the top. Meant to be used after editing the
// schedule significantly — without this, an edit could otherwise leave the
// loop's "elapsed" position landing in the middle of a completely
// different program than before, with no clean way for the admin to just
// say "start fresh."
export async function restartChannelLoop() {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('channel_settings')
    .update({ loop_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(error.message);
}

/* ===================================================================
   The public computation: "what should be airing right now"
   =================================================================== */

// Computed server-side and handed to every viewer as a snapshot, rather
// than trusting each viewer's own device clock to do this math. A
// wrongly-set local clock is common enough that letting every viewer
// compute their own answer would mean two people watching the "same"
// channel could genuinely see different programs. One authoritative
// answer, refreshed by polling, avoids that.
export async function getChannelState(atTime = new Date()) {
  const [schedule, settings] = await Promise.all([listChannelSchedule(), getChannelSettings()]);

  const scheduled = schedule.filter((row) => row.episode); // guards against a dangling row if an episode was deleted elsewhere
  if (scheduled.length === 0) {
    return { onAir: false, serverTime: atTime.toISOString() };
  }

  const totalDurationSeconds = scheduled.reduce((sum, row) => sum + Number(row.duration_seconds), 0);
  if (totalDurationSeconds <= 0) {
    return { onAir: false, serverTime: atTime.toISOString() };
  }

  const loopStartedAt = new Date(settings.loop_started_at).getTime();
  const elapsedSeconds = ((atTime.getTime() - loopStartedAt) / 1000) % totalDurationSeconds;
  // JS modulo can return negative for a negative dividend (loop_started_at
  // in the future — shouldn't happen, but cheap to guard against a
  // negative offset breaking playback if a clock is ever wrong).
  const normalizedElapsed = elapsedSeconds < 0 ? elapsedSeconds + totalDurationSeconds : elapsedSeconds;

  let cursor = 0;
  let currentIndex = 0;
  for (let i = 0; i < scheduled.length; i++) {
    const dur = Number(scheduled[i].duration_seconds);
    if (normalizedElapsed < cursor + dur) {
      currentIndex = i;
      break;
    }
    cursor += dur;
    currentIndex = i;
  }

  const current = scheduled[currentIndex];
  const offsetSeconds = Math.max(0, normalizedElapsed - cursor);
  const next = scheduled[(currentIndex + 1) % scheduled.length];

  return {
    onAir: true,
    serverTime: atTime.toISOString(),
    loopStartedAt: settings.loop_started_at,
    adsEnabled: settings.ads_enabled,
    totalLoopDurationSeconds: totalDurationSeconds,
    program: {
      scheduleId: current.id,
      offsetSeconds,
      durationSeconds: Number(current.duration_seconds),
      ...current.episode
    },
    next: {
      title: next.episode.title,
      scheduleId: next.id
    }
  };
}
