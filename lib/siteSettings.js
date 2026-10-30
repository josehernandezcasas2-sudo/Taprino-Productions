import { getSupabase } from './supabase';

export async function getSiteSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    console.error('getSiteSettings error:', error.message);
    return { shopEnabled: false, shopUrl: null, liveTvEnabled: true, verticalEnabled: true, podcastsEnabled: true, searchIconUrl: null, recommendationCloseness: 6, elevatorPitchEnabled: false, themeOverrides: {}, faviconUrl: null, appIconUrl: null, curatedRowsRandomOrder: false, logoUrl: null, adCpmCents: 600, connectLabel: 'Connect', streamLabel: 'Stream', screenCaptureBlock: true };
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
    appIconUrl: data ? data.app_icon_url : null,
    curatedRowsRandomOrder: Boolean(data && data.curated_rows_random_order),
    logoUrl: data ? data.site_logo_url : null,
    adCpmCents: data && data.ad_cpm_cents != null ? data.ad_cpm_cents : 600,
    // The nav kicker's two labels (HeaderNav) — a single source both the
    // Connect-side and Stream-side pages read from, so changing one here
    // changes it everywhere it's shown rather than needing a per-page edit.
    connectLabel: (data && data.connect_label) || 'Connect',
    streamLabel: (data && data.stream_label) || 'Stream',
    // Episode Ad Curator (migration 087): the exact section sizes, the
    // channel's ads-per-hour cap and the default rounding for a new plan.
    adSectionSizes: data && Array.isArray(data.ad_section_sizes) && data.ad_section_sizes.length ? data.ad_section_sizes.map(Number) : [10, 15, 20, 30],
    adHourCapSeconds: data && Number(data.ad_hour_cap_seconds) > 0 ? Number(data.ad_hour_cap_seconds) : 900,
    adBreakRoundSeconds: data && Number(data.ad_break_round_seconds) > 0 ? Number(data.ad_break_round_seconds) : 15,
    // Tips (migration 088 columns + 101's cap): the studio's cut of a tip,
    // the most it keeps from any one tip, and the biggest tip the sheet
    // allows. lib/tips.js reads the same columns; the Terms print them live.
    tipPlatformCutPercent: data && data.tip_platform_cut_percent != null && Number.isFinite(Number(data.tip_platform_cut_percent)) ? Number(data.tip_platform_cut_percent) : 5,
    tipCutMaxCents: data && Number(data.tip_cut_max_cents) >= 0 && data.tip_cut_max_cents != null ? Number(data.tip_cut_max_cents) : 10000,
    tipMaxCents: data && Number(data.tip_max_cents) > 0 ? Number(data.tip_max_cents) : 50000,
    // Crew pay (migration 110): the studio's service fee on secured pay,
    // charged to the poster on top of the rate. lib/crewPay.js reads the
    // same column.
    crewPayCutPercent: data && data.crew_pay_cut_percent != null && Number.isFinite(Number(data.crew_pay_cut_percent)) ? Number(data.crew_pay_cut_percent) : 8,
    // The app's screenshot block (migration 115; Admin → Settings →
    // Protection). On by default, and a database without the column reads
    // as on. /api/site-settings hands it to the app as `captureBlock`.
    screenCaptureBlock: data ? data.screen_capture_block !== false : true
  };
}
