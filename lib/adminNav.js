import { hasCapability } from './capabilities';

// The one admin navigation, grouped the way the redesign mockup laid it
// out (2026-10-08). Every admin page renders this through
// components/AdminShell.js, so adding a page = one entry here.
//
// `caps`: a sub-admin sees the entry if they hold ANY listed capability.
// No `caps` = full admins only. Full admins always see everything.
export const ADMIN_NAV = [
  {
    label: null,
    items: [{ href: '/admin', label: 'Dashboard', badge: 'review', caps: ['review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags', 'view_all_content', 'manage_applications', 'manage_house_ads', 'manage_live', 'manage_schedule', 'manage_content_lifecycle', 'manage_genre_icons', 'manage_comped_access', 'manage_episodes'] }]
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/review', label: 'Review queue', badge: 'review', caps: ['review_submissions'] },
      { href: '/admin/library', label: 'Library & queues', badge: 'library', caps: ['manage_episodes', 'manage_artwork', 'manage_deletions'] },
      { href: '/admin/content', label: 'All content & flags', badge: 'flags', caps: ['view_all_content', 'handle_flags'] },
      { href: '/admin/content-lifecycle', label: 'Lifecycle windows', caps: ['manage_content_lifecycle'] },
      { href: '/admin/curated-rows', label: 'Curated rows' },
      { href: '/admin/ratings', label: 'Ratings' },
      { href: '/admin/university', label: 'Film University', caps: ['manage_university'] },
      { href: '/admin/ownership', label: 'Series ownership' }
    ]
  },
  {
    label: 'Channels & Live',
    items: [
      { href: '/admin/channels', label: 'Channels' },
      { href: '/schedule', label: 'Scheduler', caps: ['manage_schedule'], external: true },
      { href: '/admin/channel-uploads', label: 'Channel uploads', badge: 'channel', caps: ['review_submissions'] },
      { href: '/admin/live', label: 'Go live', caps: ['manage_live'] }
    ]
  },
  {
    label: 'Pitch Room',
    items: [{ href: '/admin/pitch-room', label: 'Pitches & comments', badge: 'pitch' }]
  },
  {
    label: 'Ads',
    items: [
      { href: '/admin/house-ads', label: 'House ads', caps: ['manage_house_ads'] },
      { href: '/admin/ad-accounts', label: 'Advertiser accounts' },
      { href: '/admin/ad-credit-codes', label: 'Credit codes' }
    ]
  },
  {
    label: 'People',
    items: [
      { href: '/admin/team', label: 'Team & roles' },
      { href: '/admin/applications', label: 'Applications', caps: ['manage_applications'] },
      { href: '/admin/promo-codes', label: 'Promo codes', caps: ['manage_comped_access'] }
    ]
  },
  {
    label: 'Site',
    items: [
      { href: '/admin/styles', label: 'Styles & Guides', caps: ['manage_genre_icons'] },
      { href: '/admin/settings', label: 'Settings' },
      { href: '/admin/announcements', label: 'Announcements' },
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/audit-log', label: 'Audit log' }
    ]
  }
];

export function canSeeNavItem(account, item) {
  if (account.isAdmin) return true;
  if (!account.canAccessAdmin) return false;
  if (!item.caps) return false;
  return item.caps.some((c) => hasCapability(account, c));
}

// The groups this account can see, with empty groups dropped.
export function visibleAdminNav(account) {
  return ADMIN_NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeeNavItem(account, i)) }))
    .filter((g) => g.items.length > 0);
}

// Pages that used to exist on their own and now live inside another one.
// pages/admin/<old>.js redirects here so bookmarks keep working.
export const ADMIN_REDIRECTS = {
  '/admin/theme': '/admin/styles?tab=colors',
  '/admin/genre-icons': '/admin/styles?tab=icons#genres',
  '/admin/player-icons': '/admin/styles?tab=icons#player',
  '/admin/site-icons': '/admin/styles?tab=icons#site'
};
