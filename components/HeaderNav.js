import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { useNotifications } from '../lib/useNotifications';

export default function HeaderNav({ activeType, onTypeSelect, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(isCreator);
  const [openMenu, setOpenMenu] = useState(null); // 'ham' | 'account' | 'search' | null
  const [genreOpen, setGenreOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
        setGenreOpen(false);
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

  return (
    <header className="channel-bar" ref={rootRef}>
      <div className="left-cluster">
        <button
          className={`icon-btn ${openMenu === 'ham' ? 'active' : ''}`}
          aria-label="Browse by type and genre"
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'ham' ? null : 'ham')); }}
        >
          ☰
        </button>
        <button
          className={`icon-btn ${openMenu === 'search' ? 'active' : ''}`}
          aria-label="Search"
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'search' ? null : 'search')); }}
        >
          🔍
        </button>

        {openMenu === 'search' && (
          <div className="dropdown dropdown-left open search-dropdown">
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

        <div className="channel-mark">
          <span className="dot" aria-hidden="true" />
          <span className="on-air-text">ON AIR</span>
        </div>

        {openMenu === 'ham' && (
          <div className="dropdown dropdown-left open">
            <div className="dropdown-label">Browse by type</div>
            <Link href="/" className={`dropdown-item ${activeType === 'All' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Home
            </Link>
            <Link href="/type/series" className={`dropdown-item ${activeType === 'series' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Series
            </Link>
            <Link href="/type/movie" className={`dropdown-item ${activeType === 'movie' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Movies
            </Link>
            <Link href="/type/short" className={`dropdown-item ${activeType === 'short' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Shorts
            </Link>
            <Link href="/type/vertical" className={`dropdown-item ${activeType === 'vertical' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Vertical
            </Link>
            <Link href="/type/podcast" className={`dropdown-item ${activeType === 'podcast' ? 'active-cat' : ''}`} onClick={() => setOpenMenu(null)}>
              Podcasts
            </Link>

            <div className="dropdown-divider" />
            <div className="dropdown-label">Browse by genre</div>
            <button
              className={`dropdown-item genre-toggle ${genreOpen ? 'open' : ''}`}
              onClick={(e) => { e.stopPropagation(); setGenreOpen((v) => !v); }}
            >
              <span>All genres</span><span className="chevron">›</span>
            </button>
            {genreOpen && (
              <div className="genre-submenu open">
                {mainGenres.map((g) => (
                  <Link
                    key={g}
                    href={`/genre/${encodeURIComponent(g)}`}
                    className="dropdown-item"
                    onClick={() => { setOpenMenu(null); setGenreOpen(false); }}
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="channel-title">
        TAPRINO TRANSMISSION
        <span className="sub">a Studio Taprino screening room</span>
      </div>

      <div className="right-cluster">
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

        <button
          className={`icon-btn ${openMenu === 'account' ? 'active' : ''}`}
          aria-label="Account menu"
          onClick={(e) => { e.stopPropagation(); setOpenMenu((m) => (m === 'account' ? null : 'account')); }}
        >
          ☺
        </button>

        {openMenu === 'account' && (
          <div className="dropdown dropdown-right open account-dropdown">
            {isSignedIn ? (
              <>
                <div className="account-dropdown-header">
                  <div className="account-dropdown-avatar">☺</div>
                  <div>
                    <div className="account-dropdown-email">{email || 'Your account'}</div>
                    <div className="account-dropdown-tier">{isSubscriber ? 'Cipher Circle member' : 'Free account'}</div>
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
                  <Link href="/account" className="dropdown-item">✦ Join the Cipher Circle</Link>
                )}
                {isCreator && <div className="dropdown-divider" />}
                {isCreator && <Link href="/creator" className="dropdown-item">🎬 Submit an Episode</Link>}
                <div className="dropdown-divider" />
                <button className="dropdown-item" onClick={() => signOut({ redirectUrl: '/' })}>↩ Sign Out</button>
              </>
            ) : (
              <>
                <div className="dropdown-label">Account</div>
                <Link href="/account" className="dropdown-item">→ Log in / Create account</Link>
                <Link href="/wishlist" className="dropdown-item">♥ My Wishlist</Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
