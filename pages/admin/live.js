import { useEffect, useState } from 'react';
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

const EMPTY = { title: '', description: '', genre: '', adsEnabled: true, adBreakMinutes: '10' };

export default function LiveAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null); // { stream, rtmpsUrl, rtmpsStreamKey }
  const [showKey, setShowKey] = useState(false);
  const [cfHint, setCfHint] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current || current.stream.status === 'ended') return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(`/api/admin/live/status?id=${current.stream.id}`)
        .then((r) => r.json())
        .then(setCfHint)
        .catch(() => {});
    }, 8000);
    return () => clearInterval(interval);
  }, [current]);

  async function create(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch('/api/admin/live/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          genre: form.genre,
          adsEnabled: form.adsEnabled,
          adBreakSeconds: Number(form.adBreakMinutes) * 60
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the stream.');
      setCurrent(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function goLive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/live/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: current.stream.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrent((c) => ({ ...c, stream: data.stream }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function endStream() {
    if (!window.confirm('End the live stream? Viewers on /live will see it end within about 20 seconds.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/live/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: current.stream.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrent((c) => ({ ...c, stream: data.stream }));
      window.alert(data.note);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    setCurrent(null);
    setCfHint(null);
    setForm(EMPTY);
  }

  return (
    <>
      <Head>
        <title>Go live — {SITE.name}</title>
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
            <h1>Live</h1>
            <p className="ca-sub">Broadcast to {SITE.name} with OBS or any RTMPS encoder.</p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        {!current && (
          <div className="house-ad-form-wrap" style={{ marginTop: '1.4rem' }}>
            <form onSubmit={create} className="house-ad-form">
              <label>Title</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />

              <label>Description (optional)</label>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

              <label>Genre (optional)</label>
              <input value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))} placeholder="e.g. Documentary" />

              <div className="house-ad-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label>Ad breaks</label>
                  <select
                    value={form.adsEnabled ? 'on' : 'off'}
                    onChange={(e) => setForm((f) => ({ ...f, adsEnabled: e.target.value === 'on' }))}
                  >
                    <option value="on">Enabled</option>
                    <option value="off">No ads on this stream</option>
                  </select>
                </div>
                {form.adsEnabled && (
                  <div>
                    <label>Every N minutes</label>
                    <input
                      type="number"
                      min="2"
                      value={form.adBreakMinutes}
                      onChange={(e) => setForm((f) => ({ ...f, adBreakMinutes: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <button className="unlock-btn" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create stream'}
              </button>
            </form>
          </div>
        )}

        {current && (
          <div className="house-ad-form-wrap" style={{ marginTop: '1.4rem' }}>
            <h3 style={{ marginTop: 0 }}>{current.stream.title}</h3>

            <div className="house-ad-notice">
              Point your encoder (OBS → Settings → Stream → choose &ldquo;Custom&rdquo;) at the server
              URL below, using the stream key as the password/key field. Once your preview shows
              you&rsquo;re actually connected and broadcasting, come back here and hit{' '}
              <strong>Go live to viewers</strong> — nothing is public until you do.
            </div>

            <label>Server URL</label>
            <input readOnly value={current.rtmpsUrl || ''} onFocus={(e) => e.target.select()} />

            <label>Stream key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                readOnly
                type={showKey ? 'text' : 'password'}
                value={current.rtmpsStreamKey || ''}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>

            {cfHint && (
              <p className="ca-foot">
                Cloudflare reports: <strong>{cfHint.state}</strong>. Informational only — this doesn&rsquo;t
                put you live, it&rsquo;s just a hint that your encoder connection is (or isn&rsquo;t) reaching
                Cloudflare yet.
              </p>
            )}

            <div className="acts" style={{ marginTop: '1.2rem' }}>
              {current.stream.status !== 'live' && current.stream.status !== 'ended' && (
                <button className="unlock-btn" onClick={goLive} disabled={busy}>
                  Go live to viewers
                </button>
              )}
              {current.stream.status === 'live' && (
                <button className="house-ad-remove" onClick={endStream} disabled={busy} style={{ border: '1px solid rgba(201,97,79,0.5)', borderRadius: '4px', padding: '0.6rem 1rem', background: 'transparent' }}>
                  End stream
                </button>
              )}
              {current.stream.status === 'ended' && (
                <button className="unlock-btn" onClick={startAnother}>
                  Start another
                </button>
              )}
            </div>

            {current.stream.status === 'live' && (
              <p className="ca-foot">
                Live at <Link href="/live">/live</Link> right now.
              </p>
            )}
          </div>
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
