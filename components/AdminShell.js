import { useEffect, useState } from 'react';
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

      <div className={`adm-shell ${wide ? 'adm-shell-wide' : ''}`}>
        <nav className="adm-nav" aria-label="Admin">
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
          {children}
        </main>
      </div>

      <Footer />
    </>
  );
}
