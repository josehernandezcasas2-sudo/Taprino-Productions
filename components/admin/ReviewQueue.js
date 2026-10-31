import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminReviewAdModal from '../AdminReviewAdModal';

const KIND_LABEL = { submission: 'Episode', ad: 'Ad', series: 'Series', channel: 'Channel upload', location: 'Place', price: 'Price', application: 'Application' };

// The merged "needs your review" list, fed by /api/admin/review-queue.
// Used in two places: the dashboard (compact, `limit` rows, link to see
// all) and /admin/review (everything, with filter chips). Each row
// approves inline; "Open" expands the video, description and details.
// Ads keep the full review modal (rate, placements, replace video) —
// the inline Approve for an ad uses the site's default CPM.
//
// An application (the creator path, 2026-10-31) is a film sent through
// /apply with its master: Approve puts it live (free, or Tapa + from the
// select in the detail) and grants Creator Studio; Hold sends one thing
// to fix; Reject declines and deletes the file. The master plays in
// Cloudflare's player once it has processed.
export default function ReviewQueue({ limit = null, compact = false, defaultCpmCents }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [holdingId, setHoldingId] = useState(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reviewingAd, setReviewingAd] = useState(null);
  const [previews, setPreviews] = useState({});
  const [tiers, setTiers] = useState({});
  const [flash, setFlash] = useState(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/review-queue');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load the queue.');
      setData(d);
    } catch (err) {
      setError(err.message);
      setData({ items: [], counts: { total: 0 } });
    }
  }
  useEffect(() => { load(); }, []);

  async function decide(item, decision, extra = {}) {
    setBusyId(`${item.kind}-${item.id}`);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/admin/review-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, id: item.id, decision, ...extra })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not update this.');
      if (item.kind === 'application' && decision === 'approve') {
        setFlash(d.mode === 'live'
          ? <>“{item.title}” is live at <Link href={d.episode.href}>{d.episode.href}</Link>{d.roleGranted ? ' and Creator Studio is granted' : ''}. They’ve been emailed.</>
          : `Accepted. Creator Studio is ${d.roleGranted ? 'granted' : 'already theirs'}; they upload the master there. They’ve been emailed.`);
      }
      setRejectingId(null);
      setHoldingId(null);
      setReason('');
      setOpenId(null);
      await load();
      window.dispatchEvent(new CustomEvent('taprino:admin-queue-changed'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Channel uploads need a short-lived signed URL to play.
  async function loadPreview(item) {
    if (previews[item.id]) return;
    try {
      const res = await fetch(`/api/admin/channel-media?preview=${encodeURIComponent(item.id)}`);
      const d = await res.json();
      if (res.ok && d.src) setPreviews((p) => ({ ...p, [item.id]: d.src }));
    } catch {
      // The row still shows; just no playback.
    }
  }

  function toggleOpen(item) {
    const key = `${item.kind}-${item.id}`;
    setOpenId((cur) => (cur === key ? null : key));
    if (item.kind === 'channel') loadPreview(item);
  }

  if (!data) return <p className="adm-empty">Loading…</p>;

  const items = (data.items || []).filter((i) => filter === 'all' || i.kind === filter);
  const shown = limit ? items.slice(0, limit) : items;
  const counts = data.counts || {};

  return (
    <div>
      {!compact && (
        <div className="rq-filters">
          {[['all', 'All', counts.total], ['application', 'Applications', counts.application], ['submission', 'Episodes', counts.submission], ['ad', 'Ads', counts.ad], ['series', 'Series', counts.series], ['channel', 'Channel uploads', counts.channel], ['location', 'Places', counts.location], ['price', 'Prices', counts.price]].map(([k, label, n]) => (
            <button key={k} type="button" className={`rq-chip ${filter === k ? 'is-active' : ''}`} onClick={() => setFilter(k)}>
              {label}{n ? ` ${n}` : ''}
            </button>
          ))}
        </div>
      )}
      {error && <div className="rq-error" role="alert">{error}</div>}
      {flash && <div className="rq-flash" role="status">{flash}</div>}
      {shown.length === 0 ? (
        <p className="adm-empty">Nothing waiting on review right now.</p>
      ) : shown.map((item) => {
        const key = `${item.kind}-${item.id}`;
        const busy = busyId === key;
        const src = item.kind === 'channel' ? previews[item.id] : item.media.src;
        const isApplication = item.kind === 'application';
        const approveExtra = item.kind === 'submission' ? { tierOverride: item.meta.tier } : isApplication ? { tierOverride: tiers[item.id] || 'free' } : {};
        return (
          <div key={key} className="rq-row">
            <div className="rq-thumb" style={item.media.poster ? { backgroundImage: `url(${item.media.poster})` } : undefined}>
              {!item.media.poster && KIND_LABEL[item.kind].split(' ')[0]}
            </div>
            <div>
              <div className="rq-title"><span className="rq-kind">{KIND_LABEL[item.kind]}</span>{item.title}</div>
              <div className="rq-sub">{item.subtitle}{item.createdAt && ` · ${timeAgo(item.createdAt)}`}</div>
            </div>
            <div className="rq-acts">
              {item.kind === 'ad' ? (
                <button type="button" className="rq-btn" onClick={() => setReviewingAd(item)} disabled={busy}>Review…</button>
              ) : (
                <button type="button" className="rq-btn rq-btn-ok" onClick={() => decide(item, 'approve', approveExtra)} disabled={busy} title={isApplication ? (item.meta.masterReady ? 'Puts it live now and grants Creator Studio' : 'Grants Creator Studio') : undefined}>
                  {busy ? 'Working…' : isApplication ? (item.meta.masterReady ? 'Accept · live' : 'Accept') : 'Approve'}
                </button>
              )}
              <button type="button" className="rq-btn" onClick={() => toggleOpen(item)}>{openId === key ? 'Close' : 'Open'}</button>
            </div>

            {openId === key && (
              <div className="rq-detail">
                {item.media.iframe
                  ? <iframe src={item.media.iframe} title={`${item.title} — the master`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  : src ? <video src={src} controls preload="metadata" /> : item.kind === 'channel' ? <p className="adm-empty">Loading preview…</p> : isApplication ? <p className="adm-empty">{item.meta.masterReady ? 'The master could not be signed for playback.' : item.meta.filesLink ? 'No upload; open their link below.' : 'The master is not ready to play yet (still uploading or processing). Reload in a few minutes.'}</p> : null}
                {item.description && <p>{item.description}</p>}
                {isApplication && (
                  <label className="rq-tier">
                    Who can watch
                    <select value={tiers[item.id] || 'free'} onChange={(e) => setTiers((t) => ({ ...t, [item.id]: e.target.value }))}>
                      <option value="free">Free with ads</option>
                      <option value="premium">Tapa + members</option>
                    </select>
                  </label>
                )}
                <div className="rq-kv">
                  {Object.entries(item.meta).filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object' && typeof v !== 'boolean').map(([k, v]) => (
                    <FragmentRow key={k} k={k} v={v} />
                  ))}
                </div>
                {item.kind !== 'ad' && (
                  rejectingId === key || holdingId === key ? (
                    <div>
                      <input className="rq-reason" type="text" placeholder={holdingId === key ? 'The one thing to fix (they read this)' : 'Reason (shown to the submitter)'} value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div className="rq-acts" style={{ justifyContent: 'flex-start' }}>
                        {holdingId === key
                          ? <button type="button" className="rq-btn" onClick={() => decide(item, 'hold', { reason })} disabled={busy || !reason.trim()}>Send the hold</button>
                          : <button type="button" className="rq-btn rq-btn-danger" onClick={() => decide(item, 'reject', { reason })} disabled={busy || !reason.trim()}>{isApplication ? 'Confirm decline' : 'Confirm rejection'}</button>}
                        <button type="button" className="rq-btn" onClick={() => { setRejectingId(null); setHoldingId(null); setReason(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="rq-acts" style={{ justifyContent: 'flex-start' }}>
                      {isApplication && <button type="button" className="rq-btn" onClick={() => { setHoldingId(key); setReason(''); }} disabled={busy}>Hold…</button>}
                      <button type="button" className="rq-btn rq-btn-danger" onClick={() => { setRejectingId(key); setReason(''); }} disabled={busy}>{isApplication ? 'Decline…' : 'Reject…'}</button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
      {limit && items.length > limit && (
        <div style={{ paddingTop: '0.8rem' }}>
          <Link href="/admin/review" className="adm-link-btn">See all {items.length} →</Link>
        </div>
      )}

      {reviewingAd && (
        <AdminReviewAdModal
          ad={toModalAd(reviewingAd)}
          onClose={() => setReviewingAd(null)}
          onResolved={() => { setReviewingAd(null); load(); window.dispatchEvent(new CustomEvent('taprino:admin-queue-changed')); }}
          defaultCpmCents={defaultCpmCents}
        />
      )}
    </div>
  );
}

function FragmentRow({ k, v }) {
  const label = { contentType: 'Type', hasCaptions: 'Captions', durationSeconds: 'Duration', budgetTotalCents: 'Budget', clickUrl: 'Click URL', proofUrl: 'Proof', listingUrl: 'Listing', hostSays: 'Host says', filesLink: 'Their files', goesLive: 'Accept means' }[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  let value = v;
  if (k === 'hasCaptions') value = v ? 'Yes' : 'No';
  if (k === 'durationSeconds') value = `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  if (k === 'budgetTotalCents') value = `$${(v / 100).toFixed(2)}`;
  // A proof document or the listing itself opens in a new tab.
  if (typeof v === 'string' && /^(https?:\/\/|\/)/.test(v) && (k === 'proofUrl' || k === 'listingUrl' || k === 'clickUrl' || k === 'filesLink')) {
    return (<><span>{label}</span><div><a href={v} target="_blank" rel="noreferrer">{k === 'proofUrl' ? 'Open the proof ↗' : k === 'listingUrl' ? 'Open the listing ↗' : k === 'filesLink' ? 'Open their link ↗' : v}</a></div></>);
  }
  return (<><span>{label}</span><div>{String(value)}</div></>);
}

// The ad modal expects the shape /api/admin/review-ad returns; rebuild
// the bits it reads from the normalised queue item.
function toModalAd(item) {
  return {
    id: item.id,
    title: item.title,
    videoUrl: item.media.src,
    durationSeconds: item.meta.durationSeconds,
    clickUrl: item.meta.clickUrl,
    budgetTotalCents: item.meta.budgetTotalCents,
    placements: item.meta.placements,
    accountCompanyName: item.subtitle.split(' · ')[0]
  };
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}
