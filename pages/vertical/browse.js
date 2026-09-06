import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getAllSeries } from '../../lib/series';
import { getAccountContext } from '../../lib/accountContext';
import { filterEntitledVertical } from '../../lib/verticalFeed';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [episodes, allSeries] = await Promise.all([getPublicEpisodes(), getAllSeries()]);

  const entitled = account.isSubscriber || account.isAdmin;
  const verticalEpisodes = filterEntitledVertical(episodes, entitled);

  const seriesById = new Map(allSeries.map((s) => [s.id, s]));
  const countBySeriesId = {};
  for (const e of verticalEpisodes) {
    if (e.seriesId) countBySeriesId[e.seriesId] = (countBySeriesId[e.seriesId] || 0) + 1;
  }

  const series = Object.keys(countBySeriesId)
    .map((id) => seriesById.get(id))
    .filter(Boolean)
    .map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail || s.poster || null,
      episodeCount: countBySeriesId[s.id]
    }));

  return { props: { series } };
}

export default function BrowseVerticalSeries({ series }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? series.filter((s) => s.name.toLowerCase().includes(q)) : series;

  return (
    <>
      <Head>
        <title>More vertical series — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="reel-browse">
        <div className="reel-browse-header">
          <Link href="/vertical/discover" className="reel-browse-back">&larr;</Link>
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
    </>
  );
}
