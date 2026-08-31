import { getSupabase } from './supabase';

export async function getSiteSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    console.error('getSiteSettings error:', error.message);
    return { shopEnabled: false, shopUrl: null, liveTvEnabled: true, verticalEnabled: true, podcastsEnabled: true, searchIconUrl: null, recommendationCloseness: 6, elevatorPitchEnabled: false, themeOverrides: {}, faviconUrl: null, appIconUrl: null };
  }
  return {
    shopEnabled: Boolean(data && data.shop_enabled),
    shopUrl: data ? data.shop_url : null,
    liveTvEnabled: data ? data.live_tv_enabled !== false : true,
    verticalEnabled: data ? data.vertical_enabled !== false : true,
    podcastsEnabled: data ? data.podcasts_enabled !== false : true,
    searchIconUrl: data ? data.search_icon_url : null,
    recommendationCloseness: data && data.recommendation_closeness != null ? data.recommendation_closeness : 6,
    elevatorPitchEnabled: Boolean(data && data.elevator_pitch_enabled),
    themeOverrides: (data && data.theme_overrides) || {},
    faviconUrl: data ? data.favicon_url : null,
    appIconUrl: data ? data.app_icon_url : null
  };
}
