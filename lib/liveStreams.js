import { getSupabase } from './supabase';
import { cloudflarePlaybackUrl } from './cloudflareUpload';

// The one query both the SSR page (pages/live.js) and the polled public
// endpoint (pages/api/live/current.js) need. Kept in one place so the two
// can't quietly drift into checking "is live" differently.
// Pass a channel id to only see that channel's broadcast.
export async function getCurrentLiveStream(channelId) {
  const supabase = getSupabase();
  let q = supabase
    .from('live_streams')
    .select('*')
    .eq('status', 'live');
  if (channelId) q = q.eq('channel_id', channelId);
  const { data, error } = await q
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getCurrentLiveStream error:', error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    genre: data.genre,
    playbackUrl: cloudflarePlaybackUrl(data.cloudflare_uid),
    startedAt: data.started_at,
    channelId: data.channel_id || null,
    adsEnabled: data.ads_enabled,
    adBreakSeconds: data.ad_break_seconds
  };
}
