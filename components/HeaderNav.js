import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { useNotifications } from '../lib/useNotifications';
import { SITE } from '../lib/siteConfig';

// Redesigned to match the horizontal-nav mockup: logo + top-level links on
// the left (Home/Series/Films/Vertical/Podcasts/My List), search + a
// Studio Tapa + pill + a circular avatar on the right. All the FUNCTIONALITY
// from the old hamburger-driven version is preserved — search, the account
// dropdown (settings/admin/wishlist/subscription/creator links/sign out),
// and the creator notifications bell — only the outer chrome changed.
//
// Genre browsing (previously buried in the hamburger dropdown) now lives
// behind a small "More" menu on desktop and the hamburger on mobile, since
// there isn't room for 10 genres as top-level links the way the mockup's
// five fixed content-type links fit.
export default function HeaderNav({ activeType, activeGenre, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, liveStream }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(isCreator);
  const [openMenu, setOpenMenu] = useState(null); // 'ham' | 'account' | 'search' | 'notifications' | null
  const [searchValue, setSearchValue] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, []);

  useEffect(() => {
    if (openMenu === 'search' && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [openMenu]);

  function submitSearch(e) {
    e.preventDefault();
    const term = searchValue.trim();
    if (!term) return;
    router.push({ pathname: '/', query: { q: term } });
    setOpenMenu(null);
  }

  async function openPortal(e) {
    e.preventDefault();
    setPortalLoading(true);
    try {
      const res = await fetch('/api/create-portal-session', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Could not open subscription settings.');
        setPortalLoading(false);
      }
    } catch (err) {
      alert('Could not open subscription settings.');
      setPortalLoading(false);
    }
  }

  const avatarLetter = (email && email[0] ? email[0].toUpperCase() : (isSignedIn ? '?' : ''));

  const typeLinks = [
    { href: '/', label: 'Home', match: activeType === 'All' || !activeType },
    { href: '/type/series', label: 'Series', match: activeType === 'series' },
    { href: '/type/movie', label: 'Films', match: activeType === 'movie' },
    { href: '/type/vertical', label: 'Vertical', match: activeType === 'vertical' },
    { href: '/type/podcast', label: 'Podcasts', match: activeType === 'podcast' },
  ];

  return (
    <header className="channel-bar top-nav" ref={rootRef}>
      <div className="nav-left">
        <Link href="/" className="brand-mark">
          <span className="footer-logo-badge nav-logo-badge">ST</span>
          <span className="brand-word">Studio <strong>Tapa</strong></span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {typeLinks.map((l) => (
            <Link key={l.href} href={l.href} className={`nav-link ${l.match ? 'active' : ''}`}>
              {l.label}
            </Link>
          ))}
          <Link href="/wishlist" className="nav-link">My List</Link>
          <Link href="/channel" className="nav-link nav-link-live">
            <i className="live-dot" aria-hidden="true" />
            Live TV
          </Link>
        </nav>

        {/* Mobile fallback + genre browsing on any screen size — the five
            fixed content-type links above don't leave room for a variable
            list of genres, so genres always live behind this menu. */}
        <button
          className={`icon-btn nav-hamburger ${openMenu === 'ham' ? 'active' : ''}`}
          aria-label="Browse by type and genre"
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'ham' ? null : 'ham')); }}
        >
          ☰
        </button>

        {openMenu === 'ham' && (
          <div className="dropdown dropdown-left open">
            <div className="dropdown-label">Browse by type</div>
            {typeLinks.map((l) => (
              <Link key={l.href} href={l.href} className={`dropdown-item ${l.match ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
                {l.label}
              </Link>
            ))}
            <Link href="/wishlist" className="dropdown-item" onClick={() => setOpenMenu(null)}>My List</Link>
            <Link href="/channel" className="dropdown-item" onClick={() => setOpenMenu(null)}>Live TV</Link>

            {mainGenres && mainGenres.length > 0 && (
              <>
                <div className="dropdown-divider" />
                <div className="dropdown-label">Browse by genre</div>
                {mainGenres.map((g) => (
                  <Link
                    key={g}
                    href={`/genre/${encodeURIComponent(g)}`}
                    className={`dropdown-item ${activeGenre === g ? 'active-cat' : ''}`}
                    onClick={() => setOpenMenu(null)}
                  >
                    {g}
                  </Link>
                ))}
              </>
            )}
          </div>
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
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'search' ? null : 'search')); }}
        >
          🔍
        </button>

        {openMenu === 'search' && (
          <div className="dropdown dropdown-right open search-dropdown">
            <form onSubmit={submitSearch}>
              <input
                ref={searchInputRef}
                type="search"
                className="header-search-input"
                placeholder="Search episodes, artists, genres…"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </form>
          </div>
        )}

        {isCreator && (
          <>
            <button
              className={`icon-btn ${openMenu === 'notifications' ? 'active' : ''}`}
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
              onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'notifications' ? null : 'notifications')); }}
              style={{ position: 'relative' }}
            >
              🔔
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>

            {openMenu === 'notifications' && (
              <div className="dropdown dropdown-right open notification-dropdown">
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
                      onClick={() => !n.read && markRead(n.id)}
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

        <Link href="/account" className="tapa-plus-pill">
          {SITE.premiumTier}
        </Link>

        <button
          className={`avatar-btn ${openMenu === 'account' ? 'active' : ''}`}
          aria-label="Account menu"
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'account' ? null : 'account')); }}
        >
          {isSignedIn ? avatarLetter : '☺'}
        </button>

        {openMenu === 'account' && (
          <div className="dropdown dropdown-right open account-dropdown">
            {isSignedIn ? (
              <>
                <div className="account-dropdown-header">
                  <div className="account-dropdown-avatar">{avatarLetter || '☺'}</div>
                  <div>
                    <div className="account-dropdown-email">{email || 'Your account'}</div>
                    <div className="account-dropdown-tier">{isSubscriber ? `${SITE.premiumTier} member` : 'Free account'}</div>
                  </div>
                </div>
                <div className="dropdown-divider" />
                <Link href="/account" className="dropdown-item">⚙ Account Settings</Link>
                {isAdmin && <Link href="/admin" className="dropdown-item">🔒 Admin Portal</Link>}
                <Link href="/wishlist" className="dropdown-item">♥ My Wishlist</Link>
                {isSubscriber ? (
                  <button className="dropdown-item" onClick={openPortal} disabled={portalLoading}>
                    💳 {portalLoading ? 'Opening…' : 'Manage Subscription'}
                  </button>
                ) : (
                  <Link href="/account" className="dropdown-item">✦ Join {SITE.premiumTier}</Link>
                )}
                {isCreator && <div className="dropdown-divider" />}
                {isCreator && <Link href="/creator/analytics" className="dropdown-item">📊 Your numbers</Link>}
                <div className="dropdown-divider" />
                <Link href="/apply" className="dropdown-item">🎬 Submit your work</Link>
                <div className="dropdown-divider" />
                <button className="dropdown-item" onClick={() => signOut({ redirectUrl: '/' })}>↩ Sign Out</button>
              </>
            ) : (
              <>
                <div className="dropdown-label">Account</div>
                <Link href="/account" className="dropdown-item">→ Log in / Create account</Link>
                <Link href="/wishlist" className="dropdown-item">♥ My Wishlist</Link>
                <div className="dropdown-divider" />
                <Link href="/apply" className="dropdown-item">🎬 Submit your work</Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
