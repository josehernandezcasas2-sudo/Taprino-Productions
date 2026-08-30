// Single source of truth for the small tier badge shown on every card,
// row, and hero across the site ("Free with ads", "Free", "Studio Tapa +").
// This used to be duplicated as `tier === 'premium' ? SITE.premiumTier :
// 'Free with ads'` in 17 different places, which only ever recognized two
// states — there was no way to show a free, ad-free title distinctly from
// a free, ad-supported one, even though the underlying `ads_enabled` field
// already existed and already controlled whether ads actually play.
//
// The key doubles as the CSS class name (see .tier-badge.* in
// globals.css) — keep them in sync if this changes.
import { SITE } from './siteConfig';

export function tierBadge(tier, adsEnabled) {
  if (tier === 'premium') return { key: 'premium', label: SITE.premiumTier };
  if (adsEnabled === false) return { key: 'free-noads', label: 'Free' };
  return { key: 'free-ads', label: 'Free with ads' };
}
