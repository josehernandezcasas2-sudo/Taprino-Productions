import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

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
              <div className="ca-stat">
                <b>{t.windowViews.toLocaleString()}</b>
                <small>Last {data.days} days</small>
              </div>
              <div className="ca-stat">
                <b>{t.published}</b>
                <small>Published</small>
              </div>
              <div className="ca-stat">
                <b>{t.pending}</b>
                <small>Awaiting review</small>
              </div>
            </div>

            {t.changePct !== null && (
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
                  <span role="columnheader" className="ca-num">Views</span>
                </div>
                {data.perEpisode.map((ep) => {
                  const share = t.views > 0 ? (ep.views / t.views) * 100 : 0;
                  return (
                    <div className="ca-tr" role="row" key={ep.id}>
                      <span role="cell" className="ca-title">
                        <Link href={`/episode/${ep.id}`}>{ep.title}</Link>
                        {ep.seriesOrder ? <em> · Ep. {ep.seriesOrder}</em> : null}
                        {/* The bar makes the spread obvious at a glance — which is
                            usually the real question, not the raw number. */}
                        <span className="ca-bar" aria-hidden="true">
                          <i style={{ width: `${share}%` }} />
                        </span>
                      </span>
                      <span role="cell">
                        <span className={`ca-tier ${ep.tier}`}>
                          {ep.tier === 'premium' ? SITE.premiumTier : 'Free'}
                        </span>
                      </span>
                      <span role="cell" className="ca-num">{ep.views.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="ca-foot">
              A view is counted once per episode page load. It doesn&rsquo;t yet tell you how much of an
              episode people actually watched — watch-through time is the more useful number, and
              it&rsquo;s the next thing to add here.
            </p>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>{SITE.nameUpper}</span>
        <span>© {new Date().getFullYear()} {SITE.studio}</span>
        <span className="footer-legal">
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
