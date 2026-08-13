import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const STATUS_LABEL = { new: 'New', reviewing: 'Reviewing', accepted: 'Accepted', declined: 'Declined' };

export default function ApplicationsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [apps, setApps] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/applications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApps(data.applications);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function setStatus(app, status) {
    setBusyId(app.id);
    try {
      const res = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: app.id, status })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApps((prev) => prev.map((a) => (a.id === app.id ? data.application : a)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = apps ? (filter === 'all' ? apps : apps.filter((a) => a.status === filter)) : [];
  const counts = apps
    ? apps.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {})
    : {};

  return (
    <>
      <Head>
        <title>Applications — Taprino Transmission</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        onTypeSelect={() => {}}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Applications</h1>
            <p className="ca-sub">
              Creators applying via <Link href="/apply">/apply</Link>. Accepting one is a note to
              yourself — the actual ingest is still manual: get the files, QC them, upload to
              Cloudflare, then add the episode.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        {apps && (
          <div className="ca-stats" style={{ marginTop: '1.2rem' }}>
            <div className="ca-stat"><b>{counts.new || 0}</b><small>New</small></div>
            <div className="ca-stat"><b>{counts.reviewing || 0}</b><small>Reviewing</small></div>
            <div className="ca-stat"><b>{counts.accepted || 0}</b><small>Accepted</small></div>
            <div className="ca-stat"><b>{apps.length}</b><small>All time</small></div>
          </div>
        )}

        <div className="ca-range" style={{ marginTop: '1.2rem' }}>
          {['all', 'new', 'reviewing', 'accepted', 'declined'].map((f) => (
            <button key={f} className={`ca-range-btn ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        {!apps && !error && <div className="ca-empty">Loading…</div>}
        {apps && shown.length === 0 && (
          <div className="ca-empty">
            <b>Nothing here</b>
            {filter === 'all' ? 'No applications yet — share the /apply link to start collecting them.' : `No applications with status "${STATUS_LABEL[filter]}".`}
          </div>
        )}

        <div className="house-ad-list">
          {shown.map((app) => (
            <div key={app.id} className="house-ad-card app-card">
              <div className="house-ad-info">
                <div className="house-ad-title">{app.title}</div>
                <div className="house-ad-meta">
                  {app.name} · {app.email} · {new Date(app.created_at).toLocaleDateString()}
                </div>
                <div className="house-ad-meta">
                  {[app.content_type, app.main_genre, app.runtime, app.completion_status].filter(Boolean).join(' · ')}
                </div>
                <p className="app-logline">{app.logline}</p>

                {openId === app.id && (
                  <div className="app-detail">
                    {app.description && <p>{app.description}</p>}
                    {app.portfolio_url && (
                      <p><strong>Portfolio:</strong> <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer">{app.portfolio_url}</a></p>
                    )}
                    {app.media_link && (
                      <p><strong>Files:</strong> <a href={app.media_link} target="_blank" rel="noopener noreferrer">{app.media_link}</a></p>
                    )}
                    {app.media_notes && <p><strong>Format notes:</strong> {app.media_notes}</p>}
                    <p>
                      <a href={`mailto:${app.email}?subject=${encodeURIComponent(`Your submission to Taprino Transmission — ${app.title}`)}`}>
                        Email {app.name} →
                      </a>
                    </p>
                  </div>
                )}

                <button className="a11y-link" onClick={() => setOpenId(openId === app.id ? null : app.id)}>
                  {openId === app.id ? 'Hide details' : 'Show details'}
                </button>
              </div>

              <div className="house-ad-actions">
                <span className={`b ${app.status === 'accepted' ? 'ok' : app.status === 'declined' ? 'bad' : 'warn'}`}>
                  {STATUS_LABEL[app.status]}
                </span>
                {app.status !== 'reviewing' && <button onClick={() => setStatus(app, 'reviewing')} disabled={busyId === app.id}>Reviewing</button>}
                {app.status !== 'accepted' && <button onClick={() => setStatus(app, 'accepted')} disabled={busyId === app.id}>Accept</button>}
                {app.status !== 'declined' && <button onClick={() => setStatus(app, 'declined')} disabled={busyId === app.id} className="house-ad-remove">Decline</button>}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
        <span className="footer-legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
