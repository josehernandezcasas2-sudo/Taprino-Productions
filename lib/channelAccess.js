import { getSupabase } from './supabase';
import { hasCapability } from './capabilities';

// Who can schedule which channel.
//   admin                         every channel
//   sub-admin with manage_schedule every channel
//   content scheduler             only channels an admin assigned them to
// Creating, renaming, deleting channels and assigning schedulers stays
// admin-only (pages/api/admin/channels.js).

export async function assignedChannelIds(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase.from('channel_schedulers').select('channel_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.channel_id);
}

export async function canScheduleChannel(roleContext, channelId) {
  if (!roleContext || !roleContext.userId || !channelId) return false;
  if (roleContext.isAdmin || hasCapability(roleContext, 'manage_schedule')) return true;
  if (!roleContext.isContentScheduler) return false;
  return (await assignedChannelIds(roleContext.userId)).includes(channelId);
}

// The channels this person can open in the scheduler, drafts included.
export async function schedulableChannels(roleContext) {
  if (!roleContext || !roleContext.userId) return [];
  const supabase = getSupabase();
  let q = supabase.from('channels').select('id, slug, name, number, visibility, logo_url, image_url').order('number', { ascending: true });
  if (!(roleContext.isAdmin || hasCapability(roleContext, 'manage_schedule'))) {
    if (!roleContext.isContentScheduler) return [];
    const ids = await assignedChannelIds(roleContext.userId);
    if (!ids.length) return [];
    q = q.in('id', ids);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}
