import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { HouseIcon, WatchTabIcon, CompassIcon, AccountIcon, usePlayerIconOverrides } from './PlayerIcons';

// Four tabs, down from the previous five: Series and Films folded into one
// "Watch" tab, My List moved into the Account menu alongside My Work, and
// a new Discover tab surfaces the two swipe/reel discovery experiences
// (Pitch Discover, Vertical Discover) that previously had no dedicated
// spot in mobile navigation at all.
//
// Home stays a direct link, same as before. The other three are toggle
// buttons that open a small drop-up menu above themselves — tapping one
// that's already open closes it, tapping a different one switches to it,
// and tapping anywhere else on the page (or navigating) closes whatever's
// open. Hidden entirely above 900px, where the header nav is already
// comfortable — unchanged from before.
const GROUPS = {
  discover: {
    label: 'Discover',
    Icon: CompassIcon,
    iconKey: 'tab_discover',
    items: [
      { href: '/pitches/discover', label: 'Pitch Discover' },
      { href: '/vertical/discover', label: 'Vertical Discover' }
    ],
    match: (p) => p === '/pitches/discover' || p === '/vertical/discover'
  },
  watch: {
    label: 'Watch',
    Icon: WatchTabIcon,
    iconKey: 'tab_watch',
    items: [
      { href: '/type/series', label: 'Watch Series' },
      { href: '/type/movie', label: 'Watch Movies' },
      { href: '/podcasts', label: 'Podcasts' },
      { href: '/vertical/browse', label: 'Vertical' }
    ],
    match: (p, q) =>
      (p === '/type/[type]' && (q.type === 'series' || q.type === 'movie')) ||
      p === '/podcasts' ||
      p === '/podcasts/[id]' ||
      p === '/vertical/browse'
  },
  account: {
    label: 'Account',
    Icon: AccountIcon,
    iconKey: 'tab_account',
    // A function rather than a plain array — "My Work" only makes sense
    // for accounts that actually have something to submit or track,
    // matching the exact same isCreator || isAdmin gate the desktop
    // header nav already uses for its own "Your work" link.
    items: (roles) => [
      { href: '/account', label: 'Settings / Account' },
      { href: '/wishlist', label: 'My List' },
      ...(roles.isCreator || roles.isAdmin ? [{ href: '/creator/my-work', label: 'My Work' }] : [])
    ],
    match: (p) => p === '/account' || p === '/wishlist' || p.startsWith('/creator')
  }
};

export default function MobileTabBar() {
  const router = useRouter();
  const path = router.pathname;
  const query = router.query || {};
  const iconOverrides = usePlayerIconOverrides();
  const [openMenu, setOpenMenu] = useState(null);
  const [roles, setRoles] = useState({ isSignedIn: false, isCreator: false, isAdmin: false });
  const barRef = useRef(null);

  // Self-fetched rather than threaded down as a prop — MobileTabBar is
  // rendered bare on every single page, and adding a new required prop
  // to all of them just for one conditionally-shown menu item isn't worth
  // the sweep. Same reasoning HeaderNav already uses for its own
  // shop-settings fetch.
  useEffect(() => {
    fetch('/api/my-role')
      .then((r) => r.json())
      .then(setRoles)
      .catch(() => {});
  }, []);

  // The bar doesn't remount between pages (it's mounted once, in
  // _app.js), so an open menu needs to be explicitly closed on
  // navigation — otherwise tapping one of its own links would leave it
  // sitting open over the new page.
  useEffect(() => {
    setOpenMenu(null);
  }, [path]);

  // Close on a tap anywhere outside the bar itself.
  useEffect(() => {
    if (!openMenu) return undefined;
    function handleOutside(e) {
      if (barRef.current && !barRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [openMenu]);

  const homeActive = path === '/';
  const openGroup = openMenu ? GROUPS[openMenu] : null;
  const openItems = openGroup ? (typeof openGroup.items === 'function' ? openGroup.items(roles) : openGroup.items) : [];

  return (
    <nav className="tabbar" aria-label="Primary" ref={barRef}>
      {openGroup && (
        <div className={`tabbar-dropup tabbar-dropup-${openMenu}`} role="menu">
          {openItems.map((item) => (
            <Link key={item.href} href={item.href} className="tabbar-dropup-item" role="menuitem">
              {item.label}
            </Link>
          ))}
        </div>
      )}

      <button
        type="button"
        className={`tabbar-item tabbar-discover ${GROUPS.discover.match(path) ? 'active' : ''} ${openMenu === 'discover' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'discover' ? null : 'discover'))}
        aria-expanded={openMenu === 'discover'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><CompassIcon size={20} src={iconOverrides.tab_discover} /></span>
        <span className="tabbar-label">Discover</span>
      </button>

      <Link href="/" className={`tabbar-item ${homeActive ? 'active' : ''}`} aria-current={homeActive ? 'page' : undefined}>
        <span className="tabbar-glyph"><HouseIcon size={20} src={iconOverrides.tab_home} /></span>
        <span className="tabbar-label">Home</span>
      </Link>

      <button
        type="button"
        className={`tabbar-item ${GROUPS.watch.match(path, query) ? 'active' : ''} ${openMenu === 'watch' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'watch' ? null : 'watch'))}
        aria-expanded={openMenu === 'watch'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><WatchTabIcon size={20} src={iconOverrides.tab_watch} /></span>
        <span className="tabbar-label">Watch <span className="tabbar-caret" aria-hidden="true">▲</span></span>
      </button>

      <button
        type="button"
        className={`tabbar-item ${GROUPS.account.match(path) ? 'active' : ''} ${openMenu === 'account' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'account' ? null : 'account'))}
        aria-expanded={openMenu === 'account'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><AccountIcon size={20} src={iconOverrides.tab_account} /></span>
        <span className="tabbar-label">Account <span className="tabbar-caret" aria-hidden="true">▲</span></span>
      </button>
    </nav>
  );
}
