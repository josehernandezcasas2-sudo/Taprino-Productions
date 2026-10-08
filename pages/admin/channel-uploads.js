import { useEffect, useRef, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import Link from 'next/link';

// Review queue for channel-only uploads (bumpers, station IDs, promos,
// shows). Same permission as reviewing creator submissions.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['review_submissions'] });
}

function dur(sec) {
  if (!sec) return 'still processing';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function Preview({ id }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let hls;
    let cancelled = false;
    fetch(`/api/admin/channel-media?preview=${id}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (cancelled || !ref.current) return;
        if (!d.src) throw new Error(d.error || 'No video.');
        if (d.src.includes('.m3u8')) {
          const { default: Hls } = await import('hls.js');
          if (Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(d.src);
            hls.attachMedia(ref.current);
            return;
          }
        }
        ref.current.src = d.src;
      })
      .catch((err) => setError(err.message));
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [id]);
  if (error) return <div className="house-ad-error">{error}</div>;
  return <video ref={ref} controls playsInline className="cu-video" />;
}

export default function ChannelUploads({ account, mainGenres }) {
  const [media, setMedia] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [watching, setWatching] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/admin/channel-media');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMedia(d.media);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function review(id, action) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/channel-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, reason: action === 'reject' ? reason : undefined })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminShell account={account} mainGenres={mainGenres} title="Channel uploads" crumbs={['Channels & Live']}>
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Channel uploads</h1>
            <p className="ca-sub">Bumpers, station IDs, promos and shows that Content Schedulers uploaded to play on channels only. Nothing here airs until you approve it.</p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" role="alert" style={{ marginTop: '1rem' }}>{error}</div>}
        {!media && !error && <div className="ca-empty" style={{ marginTop: '1rem' }}>Loading…</div>}
        {media && media.length === 0 && <div className="ca-empty" style={{ marginTop: '1rem' }}><b>Nothing waiting</b>New channel uploads show up here.</div>}

        <div className="cu-list">
          {media && media.map((m) => (
            <div key={m.id} className="cu-card">
              <div className="cu-top">
                <div className="cu-thumb" style={m.thumbnail ? { backgroundImage: `url(${m.thumbnail})` } : undefined} />
                <div style={{ minWidth: 0 }}>
                  <h3>{m.title}</h3>
                  <div className="cu-meta">{m.kindLabel} · {dur(m.durationSeconds)} · uploaded {new Date(m.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
              {watching === m.id ? <Preview id={m.id} /> : <button type="button" className="sch-btn" onClick={() => setWatching(m.id)}>Watch it</button>}
              {rejecting === m.id ? (
                <div className="cu-reject">
                  <label className="sch-field">
                    <span>What needs fixing</span>
                    <textarea id={`cu-reason-${m.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The audio is clipping at the end." />
                  </label>
                  <div className="sch-editor-acts">
                    <button type="button" className="sch-btn danger" disabled={busy === m.id} onClick={() => review(m.id, 'reject')}>Send back</button>
                    <button type="button" className="sch-btn" onClick={() => setRejecting(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="sch-editor-acts">
                  <button type="button" className="sch-btn primary" disabled={busy === m.id || !m.durationSeconds} onClick={() => review(m.id, 'approve')}>Approve</button>
                  <button type="button" className="sch-btn" disabled={busy === m.id} onClick={() => { setRejecting(m.id); setReason(''); }}>Send back…</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </AdminShell>
    </>
  );
}
