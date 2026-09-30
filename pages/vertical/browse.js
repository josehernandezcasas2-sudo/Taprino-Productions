import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import { getVerticalSeriesBrowseData } from '../../lib/verticalSeriesBrowse';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { series } = await getVerticalSeriesBrowseData(req);
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
    </>
  );
}
