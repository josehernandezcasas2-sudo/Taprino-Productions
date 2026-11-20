import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { keepScrollInside, panelRoom, viewBottom } from '../lib/menuScroll';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { useNotifications } from '../lib/useNotifications';
import SiteMenu from './SiteMenu';
import { ACCOUNT_TYPES_EVENT } from './account/AccountTypeBits';
import SignInHere from './SignInHere';
import { MENU_WORDS, menuSideFor } from '../lib/siteMenuRules';
import { isStreamPath } from '../lib/streamSection';
import { SearchIcon, BellIcon, HamburgerMenuIcon, usePlayerIconOverrides, ChatIcon } from './PlayerIcons';

// The site's header: the ☰, the wordmark + kicker and the primary links on
// the left; search, Messages and the bell on the right (signed out: search
// and Sign in).
//
// Option B (Jose, 2026-11-18, on the canvas
// https://claude.ai/artifact/RFSJUdzGefwe1v11cCJA6M): the photo and its
// account menu left the header — the photo is the tab bar's Account tab now
// — and the Tapa + pill went with them (Join Tapa + is in the menu's card).
// Everything the photo's menu held is in the ☰ menu (components/SiteMenu.js,
// lib/siteMenuRules.js): you, the places on each half of the site, Your
// things, Creator, Team, Settings & account, Help & legal and Log out. It is
// on every page the header is on, which matters where there is no tab bar
// (admin, the submit steps, the show pages). Messages left the primary links
// for an icon of its own beside the bell.
// A layout effect in the browser (an opening panel is placed before it is
// painted, so it never jumps), a plain effect on the server, where a
// layout effect only logs a warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function HeaderNav({ activeType, activeGenre, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, liveStream }) {
  const iconOverrides = usePlayerIconOverrides();
  const router = useRouter();
  const { signOut } = useClerk();
  const { notifications, unreadCount, messagesUnread, markRead, markAllRead } = useNotifications(isSignedIn);
  const [openMenu, setOpenMenu] = useState(null); // 'ham' (the menu) | 'search' | 'notifications' | null
  const hamRef = useRef(null);
  // Escape closes whichever menu is open.
  useEffect(() => {
    if (!openMenu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMenu]);
  function openNotification(n) {
    if (!n.read) markRead(n.id);
    if (n.href) { setOpenMenu(null); router.push(n.href); }
  }
  const [searchValue, setSearchValue] = useState('');
  const [siteSettings, setShopSettings] = useState(null);
  const [ownProfile, setOwnProfile] = useState(null);
  // What /api/my-role says about this person: the menu's Creator and Team
  // sections. The page's own isAdmin / isCreator count too (some pages pass
  // them before the answer arrives).
  const [role, setRole] = useState(null);
  const rootRef = useRef(null);

  // The primary links scroll inside their own box once they outgrow the
  // bar (.nav-links in globals.css): mark the overflow so the right edge
  // fades, and keep the active link in view when the page changes.
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      if (nav.scrollWidth > nav.clientWidth + 1) nav.setAttribute('data-overflow', '1');
      else nav.removeAttribute('data-overflow');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [router.asPath, isSignedIn, siteSettings]);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav ? nav.querySelector('.nav-link.active') : null;
    if (!active || nav.scrollWidth <= nav.clientWidth + 1) return;
    try { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* older browsers */ }
  }, [router.asPath]);
  const searchInputRef = useRef(null);

  // Self-fetched rather than passed as a prop — HeaderNav renders on every
  // page, and threading a new prop through all of them just for one
  // optional link isn't worth the sweep. This is the same reason the
  // Shop link's on/off state lives in its own tiny public API instead.
  //
  // Admins bypass the cache entirely (a unique query param guarantees a
  // miss at the CDN, not just the browser) — otherwise toggling Shop or
  // Live TV off in admin and then checking the site can show the old,
  // cached value for up to 60s (and up to 5 minutes under
  // stale-while-revalidate), which reads as "the toggle doesn't work"
  // when it actually saved correctly the whole time. Regular visitors
  // keep the cached read, since they have no reason to need
  // second-by-second freshness here.
  useEffect(() => {
    const url = isAdmin ? `/api/site-settings?t=${Date.now()}` : '/api/site-settings';
    fetch(url)
      .then((r) => r.json())
      .then((data) => setShopSettings(data))
      .catch(() => setShopSettings({ shopEnabled: false, shopUrl: null }));
  }, [isAdmin]);

  // Who this is, for the menu: a sub-admin, a content scheduler, and a
  // creator or admin on a page that didn't say (pages only pass isAdmin /
  // isCreator, and not all of them).
  useEffect(() => {
    if (!isSignedIn) { setRole(null); return undefined; }
    let live = true;
    fetch('/api/my-role')
      .then((r) => r.json())
      .then((d) => { if (live) setRole(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [isSignedIn]);

  // Same self-fetch reasoning as siteSettings above — HeaderNav renders on
  // every page, so this is cheaper than threading userId/avatarUrl/
  // stayInStream through every single page's getServerSideProps just for
  // the header. Gated on isSignedIn since the endpoint 401s otherwise.
  useEffect(() => {
    if (!isSignedIn) { setOwnProfile(null); return; }
    fetch('/api/account/profile')
      .then((r) => r.json())
      .then(setOwnProfile)
      .catch(() => {});
  }, [isSignedIn]);

  // Account types (migration 126): the Your types sheet, the sign-up
  // question and the menu's own chips announce what they saved, so the ☰
  // menu's you card follows without another read.
  useEffect(() => {
    function handleTypes(e) {
      const d = e && e.detail;
      if (!d || !Array.isArray(d.types)) return;
      setRole((r) => ({ ...(r || {}), accountTypes: { types: d.types, main: d.main || null, asked: d.asked !== false } }));
    }
    window.addEventListener(ACCOUNT_TYPES_EVENT, handleTypes);
    return () => window.removeEventListener(ACCOUNT_TYPES_EVENT, handleTypes);
  }, []);

  // The account page announces a newly saved photo (see pages/account.js).
  useEffect(() => {
    function handleProfileUpdated(e) {
      setOwnProfile((p) => (p ? { ...p, ...e.detail } : p));
    }
    window.addEventListener('taprino:own-profile-updated', handleProfileUpdated);
    return () => window.removeEventListener('taprino:own-profile-updated', handleProfileUpdated);
  }, []);

  useEffect(() => {
    function handleOutside(e) {
      // The ☰ menu is drawn into <body>, outside the header: a click in it
      // is not a click outside (its backdrop closes it by itself).
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('.site-menu-root')) return;
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, []);

  // A move to another page closes whatever is open (the menu's links close
  // it themselves; this covers Back and anything that navigates by itself).
  useEffect(() => { setOpenMenu(null); }, [router.asPath]);

  useEffect(() => {
    if (openMenu === 'search' && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [openMenu]);

  // The open panel hangs from under the bar and is its own scroll area
  // (Jose, 2026-11-14: "have the section be scrollable apart from the rest
  // of the site … reach any of the sections regardless of device … make it
  // go under the nav bar too"). Measured, not typed: the bar's height
  // changes with the breakpoint and the notch, and a phone's tab bar takes
  // the bottom of the screen. --menu-drop puts the panel's top edge on the
  // bar's bottom edge; --menu-max is the room down to the bottom of the
  // screen (or to the tab bar), past which the panel scrolls
  // (.menu-panel in globals.css). keepScrollInside stops a wheel or a drag
  // the panel can't use from moving the page behind it.
  const panelRef = useRef(null);
  useIsoLayoutEffect(() => {
    if (!openMenu) return undefined;
    const panel = panelRef.current;
    const bar = rootRef.current;
    if (!panel || !bar) return undefined;
    const fit = () => {
      const barRect = bar.getBoundingClientRect();
      const anchor = panel.offsetParent ? panel.offsetParent.getBoundingClientRect() : barRect;
      panel.style.setProperty('--menu-drop', `${Math.max(0, Math.round(barRect.bottom - anchor.bottom))}px`);
      // The phone's tab bar floats over the bottom of the page: stop above
      // it. On wide screens the same element is the rail down the left
      // edge, which a panel never has to clear.
      const tab = document.querySelector('.tabbar');
      const tabRect = tab ? tab.getBoundingClientRect() : null;
      const floor = tabRect && tabRect.height > 0 && tabRect.width > tabRect.height && tabRect.top > barRect.bottom ? tabRect.top : null;
      panel.style.setProperty('--menu-max', `${panelRoom({ top: barRect.bottom, viewBottom: viewBottom(window), floor })}px`);
    };
    fit();
    const release = keepScrollInside(panel);
    const vv = window.visualViewport;
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    window.addEventListener('scroll', fit, { passive: true });
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    return () => {
      release();
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      window.removeEventListener('scroll', fit);
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
    };
  }, [openMenu]);

  function submitSearch(e) {
    e.preventDefault();
    const term = searchValue.trim();
    if (!term) return;
    router.push({ pathname: '/stream', query: { q: term } });
    setOpenMenu(null);
  }

  const ownProfileHref = isSignedIn && ownProfile && ownProfile.userId ? `/profile/${ownProfile.handle || ownProfile.userId}` : null;

  // Deriving "what's active" from the real URL rather than trusting each
  // page to pass the right activeType prop — every page that wasn't one
  // of the 5 primary type pages was defaulting to activeType="All", which
  // this component then read as "show Home as active" regardless of
  // where you actually were. Home, My List, My Recs, Live TV, and Pitch
  // Room all get their own real match now, straight from router.pathname.
  const currentPath = router.pathname;
  const currentTypeParam = currentPath === '/type/[type]' ? router.query.type : null;
  const isWishlistPage = currentPath === '/wishlist';
  const isRecsPage = currentPath === '/recs';
  const isChannelPage = currentPath === '/live' || currentPath.startsWith('/live/');
  const isPitchesPage = currentPath === '/pitches' || currentPath === '/pitches/[id]';
  // Distinguishes the zine-style homepage (/, community/discovery — pitches,
  // profiles, creator tools, everything that isn't the watch library) from
  // the streaming library itself — every page you'd actually watch
  // something from (the library home, series/movie browse, podcasts,
  // vertical, and the episode/series/podcast pages themselves), not just
  // /stream. The label text itself comes from site_settings (admin-
  // editable on the Site Settings page) rather than being hardcoded here,
  // so changing it in one place changes it on every page that shows it.
  const inStreamSection = isStreamPath(currentPath, router.query);
  const kickerLabel = inStreamSection
    ? (siteSettings && siteSettings.streamLabel) || 'Stream'
    : (siteSettings && siteSettings.connectLabel) || 'Connect';

  // Used to be one fixed list on every page — Series/Films/Vertical/
  // Podcasts sitting right next to Pitch Discover, on the Connect
  // homepage, made no more sense than Pitch Discover showing up while
  // watching an episode. Now it mirrors the same Connect/Stream split
  // MobileTabBar already makes between its Discover tab (Pitch Discover,
  // Vertical Discover) and its Watch tab (Series, Movies, Podcasts,
  // Vertical) — same two groups, same two sides.
  //
  // Fail CLOSED while settings are still loading (siteSettings === null),
  // matching Shop below. This used to fail OPEN (show by default), which
  // meant an admin-disabled link would flash visible on every single page
  // load until the client-side fetch resolved, then vanish — looking
  // exactly like a bug that "keeps randomly popping up." Failing closed
  // means the opposite, much less confusing direction instead: a
  // legitimate enabled link can be briefly absent for a moment, then
  // appears — never the other way around.
  const typeLinks = inStreamSection
    ? [
        { href: '/stream', label: 'Home', match: currentPath === '/stream' },
        { href: '/type/series', label: 'Series', match: currentTypeParam === 'series' },
        { href: '/type/movie', label: 'Films', match: currentTypeParam === 'movie' },
        ...(siteSettings && siteSettings.verticalEnabled !== false
          ? [{ href: '/type/vertical', label: 'Vertical', match: currentTypeParam === 'vertical' }]
          : []),
        ...(siteSettings && siteSettings.podcastsEnabled !== false
          ? [{ href: '/podcasts', label: 'Podcasts', match: currentTypeParam === 'podcast' || currentPath === '/podcasts' || currentPath === '/podcasts/[id]' }]
          : [])
      ]
    : [
        { href: '/', label: 'Home', match: currentPath === '/' },
        { href: '/pitches/discover', label: 'Pitch Discover', match: currentPath === '/pitches/discover' },
        { href: '/crew', label: 'Crew Call', match: currentPath.startsWith('/crew') },
        { href: '/locations', label: 'Locations', match: currentPath.startsWith('/locations') },
        { href: '/productions', label: 'Productions', match: currentPath.startsWith('/productions') },
        { href: '/resources', label: 'Resources', match: currentPath.startsWith('/resources') },
        ...(siteSettings && siteSettings.verticalEnabled !== false
          ? [{ href: '/vertical/discover', label: 'Vertical Discover', match: currentPath === '/vertical/discover' }]
          : []),
        ...(siteSettings && siteSettings.elevatorPitchEnabled
          ? [{ href: '/pitches', label: 'Pitch Room', match: isPitchesPage }]
          : []),
        { href: '/university', label: 'University', match: currentPath.startsWith('/university') }
      ];

  return (
    <header className="channel-bar top-nav" ref={rootRef}>
      <div className="nav-left">
        {/* Follows the account's stayInStream preference — /stream
            straight away for someone who's set that, / otherwise. The
            two-line wordmark+kicker lockup below is the logo now — no
            separate "ST" badge — and it resizes as one unit down to
            mobile instead of the kicker surviving alone once the
            wordmark used to just disappear. */}
        {/* Mobile fallback + genre browsing on any screen size — the five
            fixed content-type links don't leave room for a variable list
            of genres, so genres always live behind this menu. It sits
            before the wordmark and is drawn without the circle the other
            icon buttons have (.nav-hamburger; Jose, 2026-10-28, the app's
            TopNav matches). */}
        <button
          ref={hamRef}
          className={`icon-btn nav-hamburger ${openMenu === 'ham' ? 'active' : ''}`}
          aria-label={MENU_WORDS.open}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'ham'}
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'ham' ? null : 'ham')); }}
        >
          {/* Was a plain "☰" character — .icon-btn's font-family stack is
              literally aimed at emoji fonts (Apple Color Emoji etc.),
              which don't all draw a glyph centered in its own em-box, so
              flexbox centering the button itself wasn't enough to center
              what actually got painted inside it. Same fix as Search and
              Notifications, which already use a drawn SVG instead of a
              character for exactly this reason. */}
          <HamburgerMenuIcon src={iconOverrides.hamburger} size={20} />
        </button>

        <Link href={ownProfile && ownProfile.stayInStream ? '/stream' : '/'} className="brand-mark">
          {siteSettings && siteSettings.logoUrl && (
            <Image
              src={siteSettings.logoUrl}
              alt=""
              width={128}
              height={32}
              style={{ height: '2rem', width: 'auto', maxWidth: '8rem', objectFit: 'contain' }}
              className="nav-logo-image"
            />
          )}
          <span className="brand-text">
            <span className="brand-word">Studio <strong>Tapa</strong></span>
            <span className={`brand-kicker ${inStreamSection ? 'brand-kicker-stream' : ''}`}>{kickerLabel}</span>
          </span>
        </Link>

        <nav className="nav-links" aria-label="Primary" ref={navRef}>
          {typeLinks.map((l) => (
            <Link key={l.href} href={l.href} className={`nav-link ${l.match ? 'active' : ''}`}>
              {l.label}{l.badge > 0 && <span className="nav-badge">{l.badge > 9 ? '9+' : l.badge}</span>}
            </Link>
          ))}
          <Link href="/wishlist" className={`nav-link ${isWishlistPage ? 'active' : ''}`}>My List</Link>
          {isSignedIn && <Link href="/recs" className={`nav-link ${isRecsPage ? 'active' : ''}`}>My Recs</Link>}
          {/* Pitch Room moved into typeLinks above — Connect-side only now,
              same reasoning as the comment there. Fails closed like
              everything else here now — same fix as Vertical/Podcasts
              above, see that comment for why. */}
          {siteSettings && siteSettings.liveTvEnabled !== false && (
            <Link href="/live" className={`nav-link nav-link-live ${isChannelPage ? 'active' : ''}`}>
              <i className="live-dot" aria-hidden="true" />
              Live TV
            </Link>
          )}
          {siteSettings && siteSettings.shopEnabled && siteSettings.shopUrl && (
            <a href={siteSettings.shopUrl} target="_blank" rel="noopener noreferrer" className="nav-link">Shop</a>
          )}
        </nav>

        {openMenu === 'ham' && (
          <SiteMenu
            onClose={() => setOpenMenu(null)}
            onSearch={() => setOpenMenu('search')}
            onSignOut={() => { setOpenMenu(null); signOut({ redirectUrl: '/' }); }}
            initialSide={menuSideFor({ inStream: inStreamSection, pathname: router.asPath, signedIn: Boolean(isSignedIn), roles: { isAdmin: Boolean(isAdmin || (role && role.isAdmin)), canAccessAdmin: Boolean(role && role.canAccessAdmin) } })}
            isSignedIn={isSignedIn}
            isSubscriber={isSubscriber}
            roles={{
              isAdmin: Boolean(isAdmin || (role && role.isAdmin)),
              isCreator: Boolean(isCreator || (role && role.isCreator)),
              canAccessAdmin: Boolean(role && role.canAccessAdmin),
              isContentScheduler: Boolean(role && role.isContentScheduler),
              permissions: role && Array.isArray(role.permissions) ? role.permissions : []
            }}
            settings={siteSettings}
            ownProfile={ownProfile}
            profileHref={ownProfileHref}
            accountTypes={isSignedIn && role ? role.accountTypes || null : null}
            mainGenres={inStreamSection ? mainGenres : null}
            activeGenre={activeGenre}
            returnFocus={hamRef}
          />
        )}
      </div>

      <div className="nav-right">
        {liveStream && (
          <Link href="/live" className="header-live-badge" aria-label={`Live now: ${liveStream.title}`}>
            <i className="live-dot" aria-hidden="true" />
            LIVE
          </Link>
        )}
        <button
          className={`icon-btn ${openMenu === 'search' ? 'active' : ''}`}
          aria-label="Search"
          aria-expanded={openMenu === 'search'}
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'search' ? null : 'search')); }}
        >
          {iconOverrides.search || (siteSettings && siteSettings.searchIconUrl) ? (
            <Image
              src={iconOverrides.search || siteSettings.searchIconUrl}
              alt=""
              width={20}
              height={20}
              style={{ borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <SearchIcon />
          )}
        </button>

        {openMenu === 'search' && (
          <div ref={panelRef} className="dropdown dropdown-right open menu-panel search-dropdown">
            <form onSubmit={submitSearch}>
              <input
                ref={searchInputRef}
                type="search"
                aria-label="Search"
                className="header-search-input"
                placeholder="Search episodes, artists, genres…"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </form>
          </div>
        )}

        {isSignedIn && (
          <>
            <Link
              href="/messages"
              className={`icon-btn header-messages ${currentPath.startsWith('/messages') ? 'active' : ''}`}
              aria-label={`Messages${messagesUnread > 0 ? ` (${messagesUnread} unread)` : ''}`}
              style={{ position: 'relative' }}
            >
              <ChatIcon size={19} />
              {messagesUnread > 0 && (
                <span className="notification-badge">{messagesUnread > 9 ? '9+' : messagesUnread}</span>
              )}
            </Link>
            <button
              className={`icon-btn ${openMenu === 'notifications' ? 'active' : ''}`}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
              onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'notifications' ? null : 'notifications')); }}
              style={{ position: 'relative' }}
            >
              <BellIcon src={iconOverrides.notification} />
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>

            {openMenu === 'notifications' && (
              <div ref={panelRef} className="dropdown dropdown-right open menu-panel notification-dropdown">
                <div className="dropdown-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <button className="notification-mark-all" onClick={markAllRead}>Mark all read</button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="dropdown-item" style={{ cursor: 'default' }}>Nothing yet.</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`notification-item ${n.read ? '' : 'unread'}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openNotification(n)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotification(n); } }}
                    >
                      <div className="notification-message">{n.message}</div>
                      <div className="notification-time">{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {!isSignedIn && (
          <SignInHere>
            <button type="button" className="header-signin-pill">{MENU_WORDS.signIn}</button>
          </SignInHere>
        )}
      </div>
    </header>
  );
}
