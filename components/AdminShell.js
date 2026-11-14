import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import HeaderNav from './HeaderNav';
import Footer from './Footer';
import { SITE } from '../lib/siteConfig';
import { visibleAdminNav } from '../lib/adminNav';

// The shell every admin page renders inside (2026-10-08 redesign): the
// site header, then a grouped left nav + the page. On phones the nav
// becomes a horizontal chip strip under the title. Nav entries are
// filtered by capability (lib/adminNav.js), so a sub-admin only sees
// pages they can open.
//
//   <AdminShell account={account} mainGenres={mainGenres} title="House ads" crumbs={['Ads']}>
//     ...page body...
//   </AdminShell>
//
// `wide` widens the content column for table-heavy pages.
//
// The side nav stays where it is while the page scrolls, and scrolls only
// when it is scrolled itself (Jose, 2026-11-14, from a screenshot of the
// nav cut off at "Money": "it seems to stop right before reaching the end
// and the top until you keep scrolling. The goal is that when you scroll
// down the page, this stays the same until we scroll down on it"). It was
// pinned to the top of the window and a whole window tall, so its first
// rows sat under the site header and its last rows below the bottom of
// the screen until the page itself was scrolled. Now it is pinned under
// the header (--adm-top, the header's measured height) and exactly as tall
// as the room below it (.adm-nav in globals.css); once it has more rows
// than fit, a wheel or a finger on it scrolls it and never the page
// (data-scrolls → overscroll-behavior), and when it fits whole the page
// scrolls under the pointer as anywhere else. Where it was scrolled to is
// kept from one admin page to the next, and the page you are on is always
// in view (the phone's chip strip too).

// A layout effect in the browser (the nav is placed before it is painted),
// a plain effect on the server, where a layout effect only logs a warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Where the nav was scrolled to: this variable across pages in one visit,
// sessionStorage across a reload.
const NAV_SCROLL_KEY = 'adm_nav_scroll';
let navScroll = null;
function readNavScroll() {
  if (navScroll) return navScroll;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(NAV_SCROLL_KEY) || 'null');
    if (saved && Number.isFinite(saved.top) && Number.isFinite(saved.left)) return saved;
  } catch (err) { /* private mode, or nothing saved */ }
  return null;
}
function storeNavScroll() {
  if (!navScroll) return;
  try { window.sessionStorage.setItem(NAV_SCROLL_KEY, JSON.stringify(navScroll)); } catch (err) { /* private mode */ }
}

// Scrolls the nav (never the page) just far enough to show `el`.
function keepInView(nav, el, pad = 12) {
  const n = nav.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < n.top + pad) nav.scrollTop -= n.top + pad - r.top;
  else if (r.bottom > n.bottom - pad) nav.scrollTop += r.bottom - (n.bottom - pad);
  if (r.left < n.left + pad) nav.scrollLeft -= n.left + pad - r.left;
  else if (r.right > n.right - pad) nav.scrollLeft += r.right - (n.right - pad);
}

export default function AdminShell({ account, mainGenres, title, crumbs = [], intro, actions, wide = false, children }) {
  const router = useRouter();
  const groups = visibleAdminNav(account);
  const [badges, setBadges] = useState({});

  // Queue counts for the nav badges. One light call; failures just mean
  // no badges.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/queue-counts')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { if (!cancelled) setBadges(d || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [router.asPath]);

  const path = router.asPath.split('?')[0].split('#')[0];
  function isActive(href) {
    if (href === '/admin') return path === '/admin';
    return path === href || path.startsWith(`${href}/`);
  }

  // The nav sits under the header: --adm-top is the header's height, and
  // data-scrolls says whether the nav has more rows than fit.
  const shellRef = useRef(null);
  const navRef = useRef(null);
  useIsoLayoutEffect(() => {
    const shell = shellRef.current;
    const nav = navRef.current;
    if (!shell || !nav) return undefined;
    const header = document.querySelector('header.channel-bar');
    const fit = () => {
      shell.style.setProperty('--adm-top', `${header ? Math.round(header.getBoundingClientRect().height) : 0}px`);
      nav.toggleAttribute('data-scrolls', nav.scrollHeight > nav.clientHeight + 1);
    };
    fit();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(fit);
      if (header) observer.observe(header);
      observer.observe(nav);
    }
    window.addEventListener('resize', fit);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  // Back where it was scrolled to, with this page's row in view. The rows
  // change size after the first paint (the mono font arrives, the queue
  // badges load), which on the phone's long chip strip moves a far chip by
  // a screen or more: the row is brought into view again each time, until
  // the person moves the nav themselves.
  const userMoved = useRef(false);
  const settleRef = useRef(null);
  useIsoLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    userMoved.current = false;
    const saved = readNavScroll();
    if (saved) { nav.scrollTop = saved.top; nav.scrollLeft = saved.left; }
    const settle = () => {
      if (userMoved.current) return;
      const active = nav.querySelector('.adm-link.is-active');
      if (active) keepInView(nav, active);
      navScroll = { top: nav.scrollTop, left: nav.scrollLeft };
    };
    settleRef.current = settle;
    settle();
    let live = true;
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(() => { if (live) settle(); }).catch(() => {});
    }
    const onScroll = () => { navScroll = { top: nav.scrollTop, left: nav.scrollLeft }; };
    const onMove = () => { userMoved.current = true; };
    const moves = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    nav.addEventListener('scroll', onScroll, { passive: true });
    moves.forEach((type) => nav.addEventListener(type, onMove, { passive: true }));
    window.addEventListener('resize', settle);
    window.addEventListener('pagehide', storeNavScroll);
    return () => {
      live = false;
      settleRef.current = null;
      nav.removeEventListener('scroll', onScroll);
      moves.forEach((type) => nav.removeEventListener(type, onMove));
      window.removeEventListener('resize', settle);
      window.removeEventListener('pagehide', storeNavScroll);
      storeNavScroll();
    };
  }, [path]);
  // The badges have just drawn (or gone): rows changed width.
  useEffect(() => { if (settleRef.current) settleRef.current(); }, [badges]);

  return (
    <>
      <Head>
        <title>{`${title} — Admin — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={account.isSignedIn}
        email={account.email}
        isAdmin={account.isAdmin}
        isCreator={account.isCreator}
        isSubscriber={account.isSubscriber}
      />

      <div ref={shellRef} className={`adm-shell ${wide ? 'adm-shell-wide' : ''}`}>
        <nav ref={navRef} className="adm-nav" aria-label="Admin">
          <div className="adm-brand">
            <span>{SITE.name}</span>
            <small>{account.isAdmin ? 'Admin' : 'Sub-admin'}</small>
          </div>
          {groups.map((g, gi) => (
            <div key={g.label || gi} className="adm-group">
              {g.label && <div className="adm-group-label">{g.label}</div>}
              {g.items.map((item) => {
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <Link key={item.href} href={item.href} className={`adm-link ${isActive(item.href) ? 'is-active' : ''}`}>
                    <span className="adm-link-label">{item.label}</span>
                    {count > 0 && <span className="adm-badge">{count}</span>}
                    {item.external && <span className="adm-ext" aria-hidden="true">↗</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <main id="main-content" className="adm-main">
          <div className="adm-crumbs">
            <Link href="/admin">Admin</Link>
            {crumbs.map((c) => <span key={c}> / {c}</span>)}
            {title && <span> / {title}</span>}
          </div>
          <div className="adm-title-row">
            <h1 className="adm-title">{title}</h1>
            {actions && <div className="adm-title-actions">{actions}</div>}
          </div>
          {intro && <p className="adm-intro">{intro}</p>}
          {account.twoFactorEnabled === false && (
            <div className="adm-twostep" role="note">
              <b>Turn on two-step verification.</b> This account can move money and read private data; a password alone is one leak away. Account → Security → Manage → add an authenticator app.{' '}
              <Link href="/account/security?twostep=1">Go to Security</Link>
            </div>
          )}
          {children}
        </main>
      </div>

      <Footer />
    </>
  );
}
