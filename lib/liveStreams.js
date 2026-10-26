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
  const { data: rows, error } = await q
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('getCurrentLiveStream error:', error.message);
    return null;
  }
  let data = (rows || [])[0] || null;
  // Without a channel asked for (the home page, /stream, the public poll),
  // only a broadcast on a public channel, or one with no channel, counts:
  // a test broadcast on a draft channel stays off the public pages
  // (security round, 2026-10-26). A caller naming a channel has already
  // decided it may see it (lib/channelEngine.js).
  if (!channelId && rows && rows.length) {
    const ids = [...new Set(rows.map((r) => r.channel_id).filter(Boolean))];
    let publicIds = new Set();
    if (ids.length) {
      const { data: channels, error: channelError } = await supabase.from('channels').select('id, visibility').in('id', ids);
      if (channelError && !/does not exist|schema cache/i.test(channelError.message || '')) {
        console.error('getCurrentLiveStream channels:', channelError.message);
        return null;
      }
      publicIds = channelError ? new Set(ids) : new Set((channels || []).filter((c) => c.visibility === 'public').map((c) => c.id));
    }
    data = rows.find((r) => !r.channel_id || publicIds.has(r.channel_id)) || null;
  }
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    description: data.description || null,
    genre: data.genre || null,
    playbackUrl: cloudflarePlaybackUrl(data.cloudflare_uid),
    startedAt: data.started_at,
    channelId: data.channel_id || null,
    adsEnabled: Boolean(data.ads_enabled),
    adBreakSeconds: data.ad_break_seconds ?? null
  };
}
