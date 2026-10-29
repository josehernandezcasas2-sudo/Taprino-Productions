import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import { getVerticalSeriesBrowseData } from '../../lib/verticalSeriesBrowse';
import { getAccountContext } from '../../lib/accountContext';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { series, mainGenres } = await getVerticalSeriesBrowseData(req);
  // Memoised per request (lib/requestCache.js), so this is the same
  // bundle the browse data already read, not a second Clerk/Stripe fetch.
  const account = await getAccountContext(req);
  return {
    props: {
      series,
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email || null,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

// The vertical library's series list (Watch → Vertical). It had no header
// until 2026-10-28 — a grid page with only a back button — so it now
// carries the Stream header like the other shelves (lib/streamSection.js
// counts it as Stream) and the tab bar.
export default function BrowseVerticalSeries({ series, mainGenres = [], isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? series.filter((s) => s.name.toLowerCase().includes(q)) : series;

  return (
    <>
      <Head>
        <title>More vertical series — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="vertical"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <div className="reel-browse">
        <div className="reel-browse-header">
          <BackButton fallbackHref="/vertical/discover" style={{ marginBottom: 0 }} />
          <div className="reel-browse-title">More vertical series</div>
        </div>

        <Link href="/vertical/discover" className="reel-browse-discover-btn">
          Discover — random episodes
        </Link>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search series…"
          className="reel-browse-search"
        />

        {series.length === 0 ? (
          <div className="poster-empty">No vertical series yet — check back soon.</div>
        ) : filtered.length === 0 ? (
          <div className="poster-empty">No series match &ldquo;{query}&rdquo;.</div>
        ) : (
          <div className="reel-browse-grid">
            {filtered.map((s) => (
              <Link key={s.id} href={`/vertical/discover?series=${s.id}`} className="reel-browse-card">
                <div
                  className="reel-browse-card-art"
                  style={{ backgroundImage: s.thumbnail ? `url(${s.thumbnail})` : undefined }}
                />
                <div className="reel-browse-card-title">{s.name}</div>
                <div className="reel-browse-card-count">{s.episodeCount} episode{s.episodeCount === 1 ? '' : 's'}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <MobileTabBar />
    </>
  );
}
