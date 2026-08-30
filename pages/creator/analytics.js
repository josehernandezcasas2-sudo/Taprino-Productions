import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';
import { tierBadge } from '../../lib/tierBadge';
import { formatRuntime } from '../../lib/videoMetadata';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// A plain inline SVG rather than a charting library — one dependency-free
// path is lighter than pulling in recharts for a single sparkline, and it
// renders identically on the server and the client.
function Sparkline({ trend }) {
  const { path, area, peak, peakDate } = useMemo(() => {
    if (!trend.length) return {};
    const w = 640;
    const h = 120;
    const max = Math.max(...trend.map((d) => d.views), 1);
    const step = trend.length > 1 ? w / (trend.length - 1) : w;
    const points = trend.map((d, i) => [i * step, h - (d.views / max) * (h - 10) - 5]);
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const filled = `${line} L${w},${h} L0,${h} Z`;
    const peakIdx = trend.reduce((best, d, i) => (d.views > trend[best].views ? i : best), 0);
    return { path: line, area: filled, peak: max, peakDate: trend[peakIdx].date };
  }, [trend]);

  if (!trend.length) return null;

  return (
    <div className="ca-chart">
      <svg viewBox="0 0 640 120" preserveAspectRatio="none" role="img" aria-label={`Views over the last ${trend.length} days. Peak of ${peak} views on ${peakDate}.`}>
        <defs>
          <linearGradient id="caFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--signal-amber)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--signal-amber)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#caFill)" />
        <path d={path} fill="none" stroke="var(--signal-amber)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ca-chart-axis">
        <span>{formatDate(trend[0].date)}</span>
        <span>peak {peak}/day</span>
        <span>{formatDate(trend[trend.length - 1].date)}</span>
      </div>
    </div>
  );
}

export default function CreatorAnalytics({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const latestRequestRef = useRef(null);

  function toggleEpisode(episodeId) {
    if (selectedEpisodeId === episodeId) {
      setSelectedEpisodeId(null);
      setDetail(null);
      latestRequestRef.current = null;
      return;
    }
    setSelectedEpisodeId(episodeId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    latestRequestRef.current = episodeId;
    fetch(`/api/creator/episode-detail-analytics?episodeId=${episodeId}`)
      .then((r) => r.json())
      .then((d) => {
        // A second click on a different episode before this slower first
        // request finished would otherwise let it resolve later and
        // overwrite the panel with the wrong episode's numbers.
        if (latestRequestRef.current !== episodeId) return;
        if (d.error) setDetailError(d.error);
        else setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => {
        if (latestRequestRef.current !== episodeId) return;
        setDetailError('Could not load this episode\u2019s numbers.');
        setDetailLoading(false);
      });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/creator/analytics?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load your numbers.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const t = data ? data.totals : null;

  return (
    <>
      <Head>
        <title>Your numbers — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main id="main-content" className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Creator dashboard</div>
            <h1>Your numbers</h1>
            <p className="ca-sub">How your work is doing on {SITE.name}. Only you can see this page.</p>
          </div>
          <Link href="/creator" className="library-back">← Back to submissions</Link>
        </div>

        <div className="ca-range" role="group" aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`ca-range-btn ${days === d ? 'on' : ''}`}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
            >
              {d} days
            </button>
          ))}
          <button
            className={`ca-range-btn ${days === 'all' ? 'on' : ''}`}
            onClick={() => setDays('all')}
            aria-pressed={days === 'all'}
          >
            All time
          </button>
        </div>

        {loading && <div className="ca-empty">Loading your numbers…</div>}
        {error && <div className="ca-empty ca-error">{error}</div>}

        {data && !loading && (
          <>
            {!data.tracking && (
              <div className="ca-notice">
                View tracking isn&rsquo;t switched on for this site yet, so these numbers will read zero
                until it is. Nothing is wrong with your episodes.
              </div>
            )}

            <div className="ca-stats">
              <div className="ca-stat">
                <b>{t.views.toLocaleString()}</b>
                <small>Views all time</small>
              </div>
              {!data.isAllTime && (
                <div className="ca-stat">
                  <b>{t.windowViews.toLocaleString()}</b>
                  <small>Last {data.days} days</small>
                </div>
              )}
              <div className="ca-stat">
                <b>{t.published}</b>
                <small>Published</small>
              </div>
              <div className="ca-stat">
                <b>{t.pending}</b>
                <small>Awaiting review</small>
              </div>
            </div>

            {!data.isAllTime && t.changePct !== null && (
              <div className={`ca-change ${t.changePct >= 0 ? 'up' : 'down'}`}>
                {t.changePct >= 0 ? '▲' : '▼'} {Math.abs(t.changePct)}% vs the {Math.floor(data.days / 2)} days
                before that
              </div>
            )}

            <Sparkline trend={data.trend} />

            <div className="eyebrow ca-section">Episode by episode</div>
            {data.perEpisode.length === 0 ? (
              <div className="ca-empty">
                Nothing published yet. Once an episode is approved it starts counting views here.
              </div>
            ) : (
              <div className="ca-table" role="table" aria-label="Views by episode">
                <div className="ca-tr ca-th" role="row">
                  <span role="columnheader">Episode</span>
                  <span role="columnheader">Tier</span>
                  <span role="columnheader" className="ca-num">Avg watch</span>
                  <span role="columnheader" className="ca-num">Views</span>
                </div>
                {data.perEpisode.map((ep) => {
                  const share = t.views > 0 ? (ep.views / t.views) * 100 : 0;
                  const selected = selectedEpisodeId === ep.id;
                  return (
                    <div
                      className={`ca-tr ca-tr-clickable ${selected ? 'selected' : ''}`}
                      role="row"
                      key={ep.id}
                      onClick={() => toggleEpisode(ep.id)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEpisode(ep.id); } }}
                      aria-pressed={selected}
                    >
                      <span role="cell" className="ca-title">
                        <Link href={`/episode/${ep.id}`} onClick={(e) => e.stopPropagation()}>{ep.title}</Link>
                        {ep.seriesOrder ? <em> · Ep. {ep.seriesOrder}</em> : null}
                        {/* Shown as actual text now, not just a bar with nothing
                            to read — a screen reader (or anyone skimming past
                            the visual) gets the same information either way. */}
                        <span className="ca-share-label">{share.toFixed(0)}% of your total views</span>
                        <span className="ca-bar" aria-hidden="true">
                          <i style={{ width: `${share}%` }} />
                        </span>
                        {ep.watchThroughPct != null && (
                          <>
                            <span className="ca-share-label">{ep.watchThroughPct}% watched through on average</span>
                            <span className="ca-bar ca-bar-watch" aria-hidden="true">
                              <i style={{ width: `${ep.watchThroughPct}%` }} />
                            </span>
                          </>
                        )}
                      </span>
                      <span role="cell">
                        <span className={`ca-tier ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
                          {tierBadge(ep.tier, ep.adsEnabled).label}
                        </span>
                      </span>
                      <span role="cell" className="ca-num">{ep.avgWatchSeconds != null ? formatRuntime(ep.avgWatchSeconds) : '—'}</span>
                      <span role="cell" className="ca-num">{ep.views.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedEpisodeId && (
              <div className="ca-detail">
                {detailLoading && <div className="ca-empty">Loading this episode&rsquo;s numbers…</div>}
                {detailError && <div className="ca-empty ca-error">{detailError}</div>}
                {detail && !detailLoading && (
                  <>
                    <div className="ca-detail-head">
                      <div>
                        <div className="eyebrow">Since it was uploaded</div>
                        <h3>{detail.episode.title}</h3>
                      </div>
                      <button className="ca-detail-close" onClick={() => toggleEpisode(selectedEpisodeId)} aria-label="Close">
                        Close ✕
                      </button>
                    </div>

                    <div className="ca-stats">
                      <div className="ca-stat">
                        <b>{detail.totals.views.toLocaleString()}</b>
                        <small>Views all time</small>
                      </div>
                      <div className="ca-stat">
                        <b>{detail.totals.avgWatchSeconds != null ? formatRuntime(detail.totals.avgWatchSeconds) : '—'}</b>
                        <small>Avg watch time</small>
                      </div>
                      <div className="ca-stat">
                        <b>{detail.totals.watchThroughPct != null ? `${detail.totals.watchThroughPct}%` : '—'}</b>
                        <small>Watched through</small>
                      </div>
                    </div>

                    {detail.trend.length > 0 ? (
                      <Sparkline trend={detail.trend} />
                    ) : (
                      <div className="ca-empty">No day-by-day data yet — check back once it&rsquo;s had some views.</div>
                    )}
                  </>
                )}
              </div>
            )}

            <p className="ca-foot">
              A view is counted once per episode page load. Avg watch is the average time spent per
              view — it only reflects signed-in viewers (anonymous playback isn&rsquo;t tracked
              server-side yet), and it&rsquo;s a raw duration rather than a percentage of the episode&rsquo;s
              length, so a longer episode will naturally show a bigger number for the same level of
              engagement.
            </p>
          </>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
