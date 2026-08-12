import { getSupabase } from './supabase';
import { cloudflarePlaybackUrl } from './cloudflareUpload';

// The one query both the SSR page (pages/live.js) and the polled public
// endpoint (pages/api/live/current.js) need. Kept in one place so the two
// can't quietly drift into checking "is live" differently.
export async function getCurrentLiveStream() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('live_streams')
    .select('*')
    .eq('status', 'live')
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
    adsEnabled: data.ads_enabled,
    adBreakSeconds: data.ad_break_seconds
  };
}
