import { PlayIcon, PauseIcon, VolumeIcon, SettingsIcon, FullscreenIcon, SearchIcon, BellIcon, InfoIcon, HeartIcon, LockIcon, SparkleIcon, TargetIcon, CardIcon, BarChartIcon, ClapperboardIcon, FolderIcon, LogoutIcon, ArrowRightIcon, HouseIcon, WatchTabIcon, CompassIcon, AccountIcon, SkipBackIcon, SkipForwardIcon, CloseIcon, TeamIcon, TvIcon, LiveDotIcon, AntennaIcon, InboxIcon, ImageIcon, SlidersIcon, CalendarIcon, PaletteIcon, HeadphonesIcon, ChatIcon, TrashIcon, WarningIcon, ClockIcon, PencilIcon, EyeIcon, UndoIcon, ExternalLinkIcon, LinkIcon, TicketIcon, BrowserTabIcon, SwipeDeckIcon } from '../PlayerIcons';

// Every replaceable icon on the site, grouped for Styles & Guides →
// Icons (components/admin/StylesGuides.js). Was pages/admin/player-icons.js's
// ICON_DEFS; the `key` is the icon_key stored by /api/admin/player-icons
// and read by usePlayerIconOverrides().
export const PLAYER_ICON_GROUPS = [
  {
    id: 'player', label: 'Video & podcast player',
    icons: [
      { key: 'play', label: 'Play', Default: () => <PlayIcon size={22} /> },
      { key: 'pause', label: 'Pause', Default: () => <PauseIcon size={22} /> },
      { key: 'volume_on', label: 'Volume (on)', Default: () => <VolumeIcon size={22} muted={false} /> },
      { key: 'volume_muted', label: 'Volume (muted)', Default: () => <VolumeIcon size={22} muted /> },
      { key: 'settings', label: 'Settings gear', Default: () => <SettingsIcon size={22} /> },
      { key: 'fullscreen_enter', label: 'Fullscreen (enter)', Default: () => <FullscreenIcon size={22} expanded={false} /> },
      { key: 'fullscreen_exit', label: 'Fullscreen (exit)', Default: () => <FullscreenIcon size={22} expanded /> },
      { key: 'skip_back', label: 'Skip back 15s', Default: () => <SkipBackIcon size={22} /> },
      { key: 'skip_forward', label: 'Skip forward 30s', Default: () => <SkipForwardIcon size={22} /> },
      { key: 'close', label: 'Close player', Default: () => <CloseIcon size={22} /> }
    ]
  },
  {
    id: 'nav', label: 'Header, tab bar & account menu',
    icons: [
      { key: 'search', label: 'Search', Default: () => <SearchIcon size={22} /> },
      { key: 'notification', label: 'Notification bell', Default: () => <BellIcon size={22} /> },
      { key: 'info', label: '"More info"', Default: () => <InfoIcon size={22} /> },
      { key: 'heart_active', label: 'Wishlist (saved)', Default: () => <HeartIcon size={22} active /> },
      { key: 'heart_inactive', label: 'Wishlist (not saved)', Default: () => <HeartIcon size={22} active={false} /> },
      { key: 'tab_home', label: 'Tab bar — Home', Default: () => <HouseIcon size={22} /> },
      { key: 'tab_watch', label: 'Tab bar — Watch', Default: () => <WatchTabIcon size={22} /> },
      { key: 'tab_discover', label: 'Tab bar — Discover', Default: () => <CompassIcon size={22} /> },
      { key: 'tab_account', label: 'Tab bar — Account', Default: () => <AccountIcon size={22} /> },
      { key: 'admin_lock', label: 'Admin portal', Default: () => <LockIcon size={22} /> },
      { key: 'sparkle', label: 'Recs / upgrade', Default: () => <SparkleIcon size={22} /> },
      { key: 'target', label: 'Pitch Room', Default: () => <TargetIcon size={22} /> },
      { key: 'pitch_swipe', label: 'Pitch Discover swipe', Default: () => <SwipeDeckIcon size={22} /> },
      { key: 'card', label: 'Manage subscription', Default: () => <CardIcon size={22} /> },
      { key: 'clapperboard', label: 'Submit / become a creator', Default: () => <ClapperboardIcon size={22} /> },
      { key: 'folder', label: 'Your work', Default: () => <FolderIcon size={22} /> },
      { key: 'logout', label: 'Sign out', Default: () => <LogoutIcon size={22} /> },
      { key: 'arrow_right', label: 'Log in', Default: () => <ArrowRightIcon size={22} /> }
    ]
  },
  {
    id: 'creator', label: 'Creator dashboard',
    icons: [
      { key: 'bar_chart', label: 'Analytics', Default: () => <BarChartIcon size={22} /> },
      { key: 'headphones', label: 'Has audio / podcast', Default: () => <HeadphonesIcon size={22} /> },
      { key: 'chat', label: 'Captions', Default: () => <ChatIcon size={22} /> },
      { key: 'trash', label: 'Delete', Default: () => <TrashIcon size={22} /> },
      { key: 'warning', label: 'Needs attention', Default: () => <WarningIcon size={22} /> },
      { key: 'clock', label: 'Pending', Default: () => <ClockIcon size={22} /> },
      { key: 'pencil', label: 'Edit', Default: () => <PencilIcon size={22} /> },
      { key: 'eye', label: 'View count', Default: () => <EyeIcon size={22} /> },
      { key: 'undo', label: 'Cancel deletion', Default: () => <UndoIcon size={22} /> },
      { key: 'external_link', label: 'View public page', Default: () => <ExternalLinkIcon size={22} /> },
      { key: 'link', label: 'Copy link', Default: () => <LinkIcon size={22} /> }
    ]
  },
  {
    id: 'admin', label: 'Admin',
    icons: [
      { key: 'team', label: 'Team & roles', Default: () => <TeamIcon size={22} /> },
      { key: 'tv', label: 'House ads / channels', Default: () => <TvIcon size={22} /> },
      { key: 'live_dot', label: 'Go live', Default: () => <LiveDotIcon size={22} /> },
      { key: 'antenna', label: 'Channel scheduler', Default: () => <AntennaIcon size={22} /> },
      { key: 'inbox', label: 'Applications', Default: () => <InboxIcon size={22} /> },
      { key: 'image', label: 'Genre icons', Default: () => <ImageIcon size={22} /> },
      { key: 'sliders', label: 'Icons', Default: () => <SlidersIcon size={22} /> },
      { key: 'calendar', label: 'Content lifecycle', Default: () => <CalendarIcon size={22} /> },
      { key: 'palette', label: 'Theme colors', Default: () => <PaletteIcon size={22} /> },
      { key: 'ticket', label: 'Promo codes', Default: () => <TicketIcon size={22} /> },
      { key: 'browser_tab', label: 'Site icons', Default: () => <BrowserTabIcon size={22} /> }
    ]
  }
];

// Same 10 genres GenreBrowseRow ships default emoji for — kept in sync
// manually since there's no single shared source for this list yet.
export const GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];
export const GENRE_DEFAULT_EMOJI = {
  Comedy: '😂', Action: '💥', Horror: '👻', 'Science Fiction': '🛸', Fantasy: '⚔️',
  Romance: '💕', Documentary: '🎬', Mystery: '🔍', Animation: '🎨', Anime: '🌸'
};

export const SITE_ICON_DEFS = [
  { target: 'favicon', label: 'Favicon', hint: 'Browser tab. Square; SVG stays sharp at any size, PNG needs to already be small and simple.' },
  { target: 'appIcon', label: 'App icon', hint: 'Home-screen install. Square, at least 512×512 if PNG; SVG scales automatically.' }
];
