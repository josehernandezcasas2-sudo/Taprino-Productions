import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { hasCapability } from '../../lib/capabilities';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  // canAccessAdmin (not isAdmin) lets sub-admins reach this page at all;
  // hasCapability then does the real gating — a sub-admin without the
  // manage_schedule permission bounces the same as a non-admin would,
  // exactly like the nav entry that leads here being hidden for them too.
  if (!account.canAccessAdmin || !hasCapability(account, 'manage_schedule')) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      // Only free-tier episodes can go on the channel — see
      // lib/channelSchedule.js for why this is enforced server-side too,
      // not just filtered here for display.
      availableEpisodes: episodes.filter((e) => e.tier === 'free'),
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ChannelAdmin({ availableEpisodes, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [schedule, setSchedule] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function load() {
    try {
      const [schedRes, setRes] = await Promise.all([fetch('/api/admin/channel/schedule'), fetch('/api/admin/channel/settings')]);
      const schedData = await schedRes.json();
      const setData = await setRes.json();
      if (!schedRes.ok) throw new Error(schedData.error);
      if (!setRes.ok) throw new Error(setData.error);
      setSchedule(schedData.schedule);
      setSettings(setData.settings);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addEpisode(episodeId) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/channel/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSchedule(data.schedule);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateEntry(id, action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/channel/schedule-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSchedule(data.schedule);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAds() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/channel/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adsEnabled: !settings.ads_enabled })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    if (!window.confirm('Restart the channel from the top of the schedule?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/channel/restart', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const scheduledIds = new Set((schedule || []).map((row) => row.episode && row.episode.id));
  const pickable = availableEpisodes.filter((e) => !scheduledIds.has(e.id));
  const totalDuration = (schedule || []).reduce((sum, row) => sum + Number(row.duration_seconds), 0);

  return (
    <>
      <Head>
        <title>Channel schedule — {SITE.name}</title>
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

      <main className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Channel schedule</h1>
            <p className="ca-sub">
              A looping, free-tier-only playlist that plays continuously at{' '}
              <Link href="/channel">/channel</Link> — like a TV channel, not on-demand.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        {schedule && (
          <div className="ca-stats" style={{ marginTop: '1.2rem' }}>
            <div className="ca-stat"><b>{schedule.length}</b><small>Scheduled</small></div>
            <div className="ca-stat"><b>{formatDuration(totalDuration)}</b><small>Full loop length</small></div>
          </div>
        )}

        {settings && (
          <div className="house-ad-notice" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>
              Ads between programs are <strong>{settings.ads_enabled ? 'on' : 'off'}</strong>. Loop started{' '}
              {new Date(settings.loop_started_at).toLocaleString()}.
            </span>
            <button onClick={toggleAds} disabled={busy}>{settings.ads_enabled ? 'Turn ads off' : 'Turn ads on'}</button>
            <button onClick={restart} disabled={busy}>Restart from the top</button>
          </div>
        )}

        <div className="eyebrow ca-section">Schedule</div>

        {!schedule && !error && <div className="ca-empty">Loading…</div>}

        {schedule && schedule.length === 0 && (
          <div className="ca-empty">
            Nothing scheduled yet. The channel shows &ldquo;nothing scheduled&rdquo; to viewers until you
            add at least one episode below.
          </div>
        )}

        {schedule && schedule.length > 0 && (
          <div className="house-ad-list">
            {schedule.map((row, i) => (
              <div key={row.id} className="house-ad-card">
                {row.episode && row.episode.thumbnail ? (
                  <img src={row.episode.thumbnail} alt="" className="house-ad-preview" />
                ) : (
                  <div className="house-ad-preview" />
                )}
                <div className="house-ad-info">
                  <div className="house-ad-title">
                    {i + 1}. {row.episode ? row.episode.title : '(episode no longer exists)'}
                  </div>
                  <div className="house-ad-meta">
                    {row.episode && row.episode.artist ? `${row.episode.artist} · ` : ''}
                    {formatDuration(row.duration_seconds)}
                  </div>
                </div>
                <div className="house-ad-actions">
                  <button onClick={() => updateEntry(row.id, 'moveUp')} disabled={busy || i === 0}>↑ Move up</button>
                  <button onClick={() => updateEntry(row.id, 'moveDown')} disabled={busy || i === schedule.length - 1}>↓ Move down</button>
                  <button onClick={() => updateEntry(row.id, 'remove')} disabled={busy} className="house-ad-remove">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="account-btn-primary" onClick={() => setPickerOpen((p) => !p)} style={{ marginTop: '1.2rem' }}>
          {pickerOpen ? 'Close' : '+ Add an episode to the schedule'}
        </button>

        {pickerOpen && (
          <div className="house-ad-form-wrap" style={{ marginTop: '0.8rem' }}>
            {pickable.length === 0 ? (
              <p className="ca-sub" style={{ margin: 0 }}>
                Every free-tier episode is already on the schedule.
              </p>
            ) : (
              <div className="house-ad-list">
                {pickable.map((ep) => (
                  <div key={ep.id} className="house-ad-card">
                    <div className="house-ad-info">
                      <div className="house-ad-title">{ep.title}</div>
                      <div className="house-ad-meta">{ep.runtime || 'no runtime set'} · {ep.mainGenre}</div>
                    </div>
                    <div className="house-ad-actions">
                      <button onClick={() => addEpisode(ep.id)} disabled={busy}>Add</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
