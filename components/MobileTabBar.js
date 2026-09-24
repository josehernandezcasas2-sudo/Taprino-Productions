import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { HouseIcon, WatchTabIcon, CompassIcon, AccountIcon, PlusIcon, CaretUpIcon, usePlayerIconOverrides } from './PlayerIcons';
import CreatePostModal from './CreatePostModal';

// Four tabs, down from the previous five: Series and Films folded into one
// "Watch" tab, My List moved into the Account menu alongside My Work, and
// a Discover tab surfaces the two swipe/reel discovery experiences
// (Pitch Discover, Vertical Discover) that previously had no dedicated
// spot in mobile navigation at all.
//
// Every tab is a toggle button that opens a small drop-up menu above
// itself — tapping one that's already open closes it, tapping a
// different one switches to it, and tapping anywhere else on the page
// (or navigating) closes whatever's open. Home used to be a plain link
// straight to /stream; it's a menu now too, offering Connect vs Stream
// explicitly rather than picking one automatically, same split as the
// header logo's stayInStream preference. Hidden entirely above 1180px,
// where the header nav's full link row is already comfortable — matches
// the width where .nav-links collapses into .nav-hamburger, so there's
// no gap between the two.
const GROUPS = {
  home: {
    label: 'Home',
    Icon: HouseIcon,
    iconKey: 'tab_home',
    // Same Connect/Stream split as the header logo's stayInStream
    // preference, but offered as an explicit choice here rather than
    // picked automatically — this is the one link in the bar people are
    // most likely to want to jump straight past into whichever half of
    // the site they weren't just in.
    items: [
      { href: '/', label: 'Connect' },
      { href: '/stream', label: 'Stream' },
      { href: '/about', label: 'About' }
    ],
    match: (p) => p === '/' || p === '/stream' || p === '/about'
  },
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const barRef = useRef(null);
  const dropdownRef = useRef(null);
  const triggerRefs = useRef({});

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

  // Keeps the floating tab bar hugging the actual bottom of the screen on
  // mobile Chrome/Safari, where the address bar slides in and out as you
  // scroll. That chrome shrinks the VISUAL viewport without changing the
  // LAYOUT viewport `position: fixed` anchors to, so without this the bar
  // sits too high the moment the chrome is showing — a strip of real page
  // content ends up visible below it instead of the bar tracking the true
  // edge. See the --vv-bottom-gap consumer on .tabbar in globals.css.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    function updateBottomGap() {
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      document.documentElement.style.setProperty('--vv-bottom-gap', `${Math.max(0, Math.round(gap))}px`);
    }
    updateBottomGap();
    vv.addEventListener('resize', updateBottomGap);
    vv.addEventListener('scroll', updateBottomGap);
    return () => {
      vv.removeEventListener('resize', updateBottomGap);
      vv.removeEventListener('scroll', updateBottomGap);
    };
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

  const openGroup = openMenu ? GROUPS[openMenu] : null;
  const openItems = openGroup ? (typeof openGroup.items === 'function' ? openGroup.items(roles) : openGroup.items) : [];

  // Centers the dropdown over whichever button actually opened it, rather
  // than the old fixed left:4px / right:4px / left:50%+translateX(-42%)
  // per-menu offsets — those were hand-tuned for one specific bar width
  // (a narrow phone) and broke as soon as the same bar rendered wider (a
  // tablet, or after the "+" button shifted Watch's position): the drop-up
  // would pop up nowhere near the button that opened it. Measuring the
  // real button and bar at open time keeps this correct at any width.
  // useLayoutEffect (not useEffect) so this is set before the browser
  // paints — no visible jump from a wrong position to the right one.
  useLayoutEffect(() => {
    if (!openMenu || !dropdownRef.current || !barRef.current) return;
    const btn = triggerRefs.current[openMenu];
    if (!btn) return;
    const barRect = barRef.current.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const dropdownWidth = dropdownRef.current.offsetWidth;
    const margin = 6;
    const btnCenter = btnRect.left + btnRect.width / 2 - barRect.left;
    let left = btnCenter - dropdownWidth / 2;
    left = Math.max(margin, Math.min(left, barRect.width - dropdownWidth - margin));
    dropdownRef.current.style.left = `${left}px`;
  }, [openMenu]);

  return (
    <nav className="tabbar" aria-label="Primary" ref={barRef}>
      {openGroup && (
        <div ref={dropdownRef} className="tabbar-dropup" role="menu">
          {openItems.map((item) => (
            <Link key={item.href} href={item.href} className="tabbar-dropup-item" role="menuitem">
              {item.label}
            </Link>
          ))}
        </div>
      )}

      <button
        ref={(el) => { triggerRefs.current.home = el; }}
        type="button"
        className={`tabbar-item ${GROUPS.home.match(path) ? 'active' : ''} ${openMenu === 'home' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'home' ? null : 'home'))}
        aria-expanded={openMenu === 'home'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><HouseIcon size={20} src={iconOverrides.tab_home} /></span>
        <span className="tabbar-label">Home <span className="tabbar-caret" aria-hidden="true"><CaretUpIcon size={7} src={iconOverrides.tab_caret} /></span></span>
      </button>

      <button
        ref={(el) => { triggerRefs.current.discover = el; }}
        type="button"
        className={`tabbar-item tabbar-discover ${GROUPS.discover.match(path) ? 'active' : ''} ${openMenu === 'discover' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'discover' ? null : 'discover'))}
        aria-expanded={openMenu === 'discover'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><CompassIcon size={20} src={iconOverrides.tab_discover} /></span>
        <span className="tabbar-label">Discover</span>
      </button>

      {roles.isAdmin && (
        <button
          type="button"
          className="tabbar-item tabbar-add"
          onClick={() => { setOpenMenu(null); setShowCreateModal(true); }}
          aria-label="New post"
          title="New post (admin test feature)"
        >
          <span className="tabbar-add-glyph"><PlusIcon size={20} /></span>
        </button>
      )}

      <button
        ref={(el) => { triggerRefs.current.watch = el; }}
        type="button"
        className={`tabbar-item ${GROUPS.watch.match(path, query) ? 'active' : ''} ${openMenu === 'watch' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'watch' ? null : 'watch'))}
        aria-expanded={openMenu === 'watch'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><WatchTabIcon size={20} src={iconOverrides.tab_watch} /></span>
        <span className="tabbar-label">Watch <span className="tabbar-caret" aria-hidden="true"><CaretUpIcon size={7} src={iconOverrides.tab_caret} /></span></span>
      </button>

      <button
        ref={(el) => { triggerRefs.current.account = el; }}
        type="button"
        className={`tabbar-item ${GROUPS.account.match(path) ? 'active' : ''} ${openMenu === 'account' ? 'open' : ''}`}
        onClick={() => setOpenMenu((m) => (m === 'account' ? null : 'account'))}
        aria-expanded={openMenu === 'account'}
        aria-haspopup="menu"
      >
        <span className="tabbar-glyph"><AccountIcon size={20} src={iconOverrides.tab_account} /></span>
        <span className="tabbar-label">Account <span className="tabbar-caret" aria-hidden="true"><CaretUpIcon size={7} src={iconOverrides.tab_caret} /></span></span>
      </button>

      {showCreateModal && <CreatePostModal onClose={() => setShowCreateModal(false)} />}
    </nav>
  );
}
