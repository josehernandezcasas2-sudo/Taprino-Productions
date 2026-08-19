import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { SITE } from '../../lib/siteConfig';
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

// Presets matching what was actually asked for — "like 2 weeks a month
// and so on" — rather than making someone type a day count for the common
// cases. The number field underneath still takes any value 1-365.
const NEW_RELEASE_PRESETS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 }
];
const LEAVING_SOON_PRESETS = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 }
];

export default function ContentLifecycleAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [settings, setSettings] = useState(null);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [expiredNotYetFlagged, setExpiredNotYetFlagged] = useState([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/admin/lifecycle-settings');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
      setLeavingSoon(data.leavingSoon);
      setExpiredNotYetFlagged(data.expiredNotYetFlagged);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/lifecycle-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(true);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runExpiryCheckNow() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/cron/expire-content', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Head>
        <title>Content lifecycle — Admin</title>
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

      <main id="main-content" className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Content lifecycle</h1>
            <p className="ca-sub">
              How long a title counts as a &ldquo;new release&rdquo; after its start date, and how
              long it shows as &ldquo;leaving soon&rdquo; before its end date. Set start/end dates on
              individual episodes from the edit modal — this page only controls the windows.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        {settings && (
          <form onSubmit={save} className="admin-edit-form" style={{ marginTop: '1.4rem', maxWidth: '32rem' }}>
            <div className="admin-field">
              <label>New release window</label>
              <p className="admin-field-hint">
                Shows in the &ldquo;New Releases&rdquo; row for this many days after its start date.
              </p>
              <div className="lifecycle-presets">
                {NEW_RELEASE_PRESETS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    className={settings.newReleaseDays === p.days ? 'on' : ''}
                    onClick={() => setSettings((s) => ({ ...s, newReleaseDays: p.days }))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max="365"
                value={settings.newReleaseDays}
                onChange={(e) => setSettings((s) => ({ ...s, newReleaseDays: parseInt(e.target.value, 10) || 1 }))}
              />
            </div>

            <div className="admin-field">
              <label>Leaving soon window</label>
              <p className="admin-field-hint">
                Shows in the &ldquo;Leaving Soon&rdquo; row for this many days before its end date.
              </p>
              <div className="lifecycle-presets">
                {LEAVING_SOON_PRESETS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    className={settings.leavingSoonDays === p.days ? 'on' : ''}
                    onClick={() => setSettings((s) => ({ ...s, leavingSoonDays: p.days }))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max="365"
                value={settings.leavingSoonDays}
                onChange={(e) => setSettings((s) => ({ ...s, leavingSoonDays: parseInt(e.target.value, 10) || 1 }))}
              />
            </div>

            <div className="admin-actions">
              <button className="account-btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && <span className="admin-video-note good">Saved.</span>}
            </div>
          </form>
        )}

        <div className="eyebrow" style={{ marginTop: '2.4rem' }}>Leaving soon ({leavingSoon.length})</div>
        {leavingSoon.length === 0 ? (
          <p className="ca-empty" style={{ marginTop: '0.6rem' }}>Nothing currently in the leaving-soon window.</p>
        ) : (
          <ul className="lifecycle-list">
            {leavingSoon.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> — leaves {new Date(item.availableUntil).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}

        <div className="eyebrow" style={{ marginTop: '1.8rem' }}>
          Expired, not yet flagged ({expiredNotYetFlagged.length})
        </div>
        <p className="admin-field-hint">
          Their end date has already passed. The daily scheduled check moves these into{' '}
          Pending Deletions (on the main admin page) automatically — this list should normally be
          empty except briefly, right before that check runs.
        </p>
        {expiredNotYetFlagged.length > 0 && (
          <>
            <ul className="lifecycle-list">
              {expiredNotYetFlagged.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong> — ended {new Date(item.availableUntil).toLocaleDateString()}
                </li>
              ))}
            </ul>
            <button className="account-btn-secondary" onClick={runExpiryCheckNow} disabled={running} style={{ width: 'auto', marginTop: '0.6rem' }}>
              {running ? 'Running…' : 'Run the check now instead of waiting'}
            </button>
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
