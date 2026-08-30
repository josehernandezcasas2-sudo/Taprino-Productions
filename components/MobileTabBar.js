import Link from 'next/link';
import { useRouter } from 'next/router';
import { DiamondIcon, SeriesListIcon, PlayIcon, SparkleIcon, AccountIcon, usePlayerIconOverrides } from './PlayerIcons';

// On a phone, every way into the site currently lives behind the header's
// dropdowns — you have to open a menu to get anywhere. This puts the five
// places people actually go one thumb-tap away, and it's the single change
// that makes the site read as an app rather than a website on a phone.
//
// These map to routes that already exist; nothing new is introduced here.
// Hidden entirely above 900px, where the header nav is already comfortable.
const TABS = [
  { href: '/', label: 'Home', Icon: DiamondIcon, iconKey: 'tab_home', match: (p) => p === '/' },
  {
    href: '/type/series',
    label: 'Series',
    Icon: SeriesListIcon,
    iconKey: 'tab_series',
    match: (p, q) => p === '/type/[type]' && q.type === 'series'
  },
  {
    href: '/type/movie',
    label: 'Films',
    Icon: PlayIcon,
    iconKey: 'play',
    match: (p, q) => p === '/type/[type]' && q.type === 'movie'
  },
  { href: '/wishlist', label: 'My list', Icon: SparkleIcon, iconKey: 'sparkle', match: (p) => p === '/wishlist' },
  { href: '/account', label: 'Account', Icon: AccountIcon, iconKey: 'tab_account', match: (p) => p === '/account' }
];

export default function MobileTabBar() {
  const router = useRouter();
  const path = router.pathname;
  const query = router.query || {};
  const iconOverrides = usePlayerIconOverrides();

  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((tab) => {
        const active = tab.match(path, query);
        const Icon = tab.Icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tabbar-item ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="tabbar-glyph"><Icon size={20} src={iconOverrides[tab.iconKey]} /></span>
            <span className="tabbar-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
