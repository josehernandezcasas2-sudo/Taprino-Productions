import { getSupabase } from './supabase';

// The full set of icon slots admin can override. Kept here as the single
// source of truth for valid keys, referenced by both the admin API
// (validates POST/DELETE requests) and the admin UI (renders one upload
// card per key). Grew beyond just the video player's own controls to
// cover site-wide icons too (search, notifications, info, wishlist) —
// the table name stayed player_icons since it already existed and
// renaming risked disrupting anything already uploaded, but the actual
// scope is broader than the name suggests now.
export const PLAYER_ICON_KEYS = [
  'play', 'pause', 'volume_on', 'volume_muted', 'settings', 'fullscreen_enter', 'fullscreen_exit',
  'search', 'notification', 'info', 'heart_active', 'heart_inactive',
  'admin_lock', 'sparkle', 'target', 'card', 'bar_chart', 'clapperboard', 'folder', 'logout', 'arrow_right',
  'tab_home', 'tab_series', 'tab_account', 'skip_back', 'skip_forward', 'close',
  'team', 'tv', 'live_dot', 'antenna', 'inbox', 'image', 'sliders', 'calendar', 'palette'
];

// Returns { icon_key: imageUrl } for every icon that has an admin-uploaded
// override. Keys not present here should fall back to the built-in SVG in
// components/PlayerIcons.js — that fallback lives client-side so an icon
// never renders as empty just because this table has no row for it yet
// (the normal, expected state before any admin has replaced anything).
export async function getPlayerIcons() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('player_icons').select('icon_key, image_url');
  if (error) {
    console.error('getPlayerIcons error:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.icon_key, row.image_url]));
}
