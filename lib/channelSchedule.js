import { getSupabase } from './supabase';
import { parseRuntimeToSeconds } from './videoMetadata';

// A channel's loop: an ordered playlist that fills any time its schedule
// leaves open (see lib/channelPlan.js for the full order of what airs).
// Every function takes a channel id; with none, it works on the main
// channel (lowest number), which is what the original single-channel
// admin page edits.

const EPISODE_FIELDS = 'id, title, description, tier, genre, artist, runtime, video_type, poster, thumbnail, rating, release_year';

async function resolveChannelId(channelId) {
  if (channelId) return channelId;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channels').select('id').order('number', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No channel exists yet.');
  return data.id;
}

export async function listChannelSchedule(channelId) {
  const id = await resolveChannelId(channelId);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('channel_schedule')
    .select(`id, position, duration_seconds, episode:episodes(${EPISODE_FIELDS})`)
    .eq('channel_id', id)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Appends an episode to the end of a channel's loop. Any tier can air on a
// channel (premium airs with ads), but only published titles whose creator
// opted in to channels.
export async function addEpisodeToSchedule(episodeId, channelId) {
  const id = await resolveChannelId(channelId);
  const supabase = getSupabase();

  const { data: episode, error: epError } = await supabase
    .from('episodes')
    .select('id, title, status, runtime, channel_opt_in, moderation_hold, series:series(channel_opt_in)')
    .eq('id', episodeId)
    .maybeSingle();
  if (epError || !episode) throw new Error('That episode could not be found.');
  if (episode.status !== 'approved') throw new Error('Only published episodes can go on a channel.');
  if (episode.moderation_hold) throw new Error('That title is pulled for review right now.');
  if (!episode.channel_opt_in && !(episode.series && episode.series.channel_opt_in)) {
    throw new Error(`"${episode.title}" isn't opted in to channels by its creator.`);
  }

  const durationSeconds = parseRuntimeToSeconds(episode.runtime);
  if (!durationSeconds) {
    throw new Error(`"${episode.title}"'s runtime ("${episode.runtime || 'not set'}") isn't in a recognizable mm:ss format — fix it on the episode itself first, since the channel needs a real duration to schedule around.`);
  }

  const { data: existing, error: existingError } = await supabase.from('channel_schedule').select('id').eq('channel_id', id).eq('episode_id', episodeId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error('That episode is already in the loop.');

  const { count, error: countError } = await supabase.from('channel_schedule').select('id', { count: 'exact', head: true }).eq('channel_id', id);
  if (countError) throw new Error(countError.message);

  const { error: insertError } = await supabase.from('channel_schedule').insert({
    channel_id: id,
    position: count || 0,
    episode_id: episodeId,
    duration_seconds: durationSeconds
  });
  if (insertError) throw new Error(insertError.message);
}

export async function removeFromSchedule(rowId) {
  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase.from('channel_schedule').select('position, channel_id').eq('id', rowId).maybeSingle();
  if (fetchError || !row) throw new Error('That loop entry no longer exists.');

  const { error: deleteError } = await supabase.from('channel_schedule').delete().eq('id', rowId);
  if (deleteError) throw new Error(deleteError.message);

  // Close the gap so positions stay contiguous from 0.
  const { data: after, error: afterError } = await supabase
    .from('channel_schedule')
    .select('id, position')
    .eq('channel_id', row.channel_id)
    .gt('position', row.position)
    .order('position', { ascending: true });
  if (afterError) throw new Error(afterError.message);

  for (const r of after || []) {
    await supabase.from('channel_schedule').update({ position: r.position - 1 }).eq('id', r.id);
  }
}

// Swaps a row with its neighbor in the same channel's loop.
export async function moveScheduleItem(rowId, direction) {
  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase.from('channel_schedule').select('id, position, channel_id').eq('id', rowId).maybeSingle();
  if (fetchError || !row) throw new Error('That loop entry no longer exists.');

  const neighborPosition = direction === 'up' ? row.position - 1 : row.position + 1;
  const { data: neighbor, error: neighborError } = await supabase
    .from('channel_schedule')
    .select('id, position')
    .eq('channel_id', row.channel_id)
    .eq('position', neighborPosition)
    .maybeSingle();
  if (neighborError) throw new Error(neighborError.message);
  if (!neighbor) return;

  // Park one row out of the way first: (channel_id, position) is unique.
  await supabase.from('channel_schedule').update({ position: -1 - row.position }).eq('id', row.id);
  await supabase.from('channel_schedule').update({ position: row.position }).eq('id', neighbor.id);
  await supabase.from('channel_schedule').update({ position: neighbor.position }).eq('id', row.id);
}

// Restarts a channel's loop from the top.
export async function restartChannelLoop(channelId) {
  const id = await resolveChannelId(channelId);
  const supabase = getSupabase();
  const { error } = await supabase
    .from('channels')
    .update({ loop_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
