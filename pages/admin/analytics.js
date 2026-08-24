import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';

export async function getServerSideProps({ req, res }) {
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    res.statusCode = 404;
    return { props: { notFound: true } };
  }
  return { props: {} };
}

function formatMinutes(mins) {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainder = Math.round(mins % 60);
  return `${hours}h ${remainder}m`;
}

const TYPE_LABEL = { series: 'Series', movie: 'Movie', short: 'Short', vertical: 'Vertical', podcast: 'Podcast' };

export default function WatchAnalytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/watch-analytics')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Could not load analytics.'));
  }, []);

  return (
    <>
      <Head><title>Watch analytics — Admin</title></Head>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem 4rem', fontFamily: 'var(--font-body)', color: 'var(--ink)' }}>
        <Link href="/admin" style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to admin</Link>
        <h1 style={{ fontFamily: 'var(--font-display)', marginTop: '0.6rem' }}>Watch analytics</h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.88rem', marginBottom: '1.8rem' }}>
          Minutes actually watched, not just page views — pulled from real playback progress. This only
          captures signed-in viewing (anonymous progress never reaches the server today), so treat these
          as a meaningful trend line rather than an exact total.
        </p>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {!data ? (
          <p>Loading…</p>
        ) : !data.configured ? (
          <div className="account-card" style={{ maxWidth: 'none' }}>
            <p>Redis isn&rsquo;t configured, so there&rsquo;s no watch-time data to show yet. Set
            <code> UPSTASH_REDIS_REST_URL</code> and <code>UPSTASH_REDIS_REST_TOKEN</code> to enable this.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2.2rem' }}>
              <div className="account-card" style={{ maxWidth: 'none', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--ink-dim)', marginBottom: '0.4rem' }}>Today</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--brass)' }}>{formatMinutes(data.dayMinutes)}</div>
              </div>
              <div className="account-card" style={{ maxWidth: 'none', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--ink-dim)', marginBottom: '0.4rem' }}>Past 7 days</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--brass)' }}>{formatMinutes(data.weekMinutes)}</div>
              </div>
              <div className="account-card" style={{ maxWidth: 'none', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase', color: 'var(--ink-dim)', marginBottom: '0.4rem' }}>Past 30 days</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--brass)' }}>{formatMinutes(data.monthMinutes)}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.4rem' }}>
              <div className="account-card" style={{ maxWidth: 'none' }}>
                <div className="account-eyebrow">Last 30 days</div>
                <h3>Most watched</h3>
                {data.mostWatched.length === 0 ? (
                  <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>Nothing watched yet.</p>
                ) : (
                  data.mostWatched.map((ep, i) => (
                    <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.55rem 0', borderTop: i > 0 ? '1px solid rgba(234,231,221,0.08)' : 'none' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', fontSize: '0.78rem', width: '1.2rem' }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>{TYPE_LABEL[ep.contentType] || ep.contentType}</div>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--brass)', flexShrink: 0 }}>{formatMinutes(ep.minutes)}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="account-card" style={{ maxWidth: 'none' }}>
                <div className="account-eyebrow">Last 30 days</div>
                <h3>Least watched</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '-0.5rem', marginBottom: '0.8rem' }}>
                  Includes anything published with zero recorded minutes — that&rsquo;s exactly what this list should surface.
                </p>
                {data.leastWatched.length === 0 ? (
                  <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>Nothing published yet.</p>
                ) : (
                  data.leastWatched.map((ep, i) => (
                    <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.55rem 0', borderTop: i > 0 ? '1px solid rgba(234,231,221,0.08)' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>{TYPE_LABEL[ep.contentType] || ep.contentType}</div>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--ink-dim)', flexShrink: 0 }}>{formatMinutes(ep.minutes)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {data.mostWatched.length > 0 && data.leastWatched.length > 0 && data.mostWatched.length <= 8 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '1rem' }}>
                With this few published titles, Most and Least Watched will naturally overlap — that&rsquo;ll
                sort itself out as the library grows.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
