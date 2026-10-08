import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminReviewAdModal from '../AdminReviewAdModal';

const KIND_LABEL = { submission: 'Episode', ad: 'Ad', series: 'Series', channel: 'Channel upload' };

// The merged "needs your review" list, fed by /api/admin/review-queue.
// Used in two places: the dashboard (compact, `limit` rows, link to see
// all) and /admin/review (everything, with filter chips). Each row
// approves inline; "Open" expands the video, description and details.
// Ads keep the full review modal (rate, placements, replace video) —
// the inline Approve for an ad uses the site's default CPM.
export default function ReviewQueue({ limit = null, compact = false, defaultCpmCents }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [reviewingAd, setReviewingAd] = useState(null);
  const [previews, setPreviews] = useState({});

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
    try {
      const res = await fetch('/api/admin/review-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, id: item.id, decision, ...extra })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not update this.');
      setRejectingId(null);
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
          {[['all', 'All', counts.total], ['submission', 'Episodes', counts.submission], ['ad', 'Ads', counts.ad], ['series', 'Series', counts.series], ['channel', 'Channel uploads', counts.channel]].map(([k, label, n]) => (
            <button key={k} type="button" className={`rq-chip ${filter === k ? 'is-active' : ''}`} onClick={() => setFilter(k)}>
              {label}{n ? ` ${n}` : ''}
            </button>
          ))}
        </div>
      )}
      {error && <div className="rq-error" role="alert">{error}</div>}
      {shown.length === 0 ? (
        <p className="adm-empty">Nothing waiting on review right now.</p>
      ) : shown.map((item) => {
        const key = `${item.kind}-${item.id}`;
        const busy = busyId === key;
        const src = item.kind === 'channel' ? previews[item.id] : item.media.src;
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
                <button type="button" className="rq-btn rq-btn-ok" onClick={() => decide(item, 'approve', item.kind === 'submission' ? { tierOverride: item.meta.tier } : {})} disabled={busy}>
                  {busy ? 'Working…' : 'Approve'}
                </button>
              )}
              <button type="button" className="rq-btn" onClick={() => toggleOpen(item)}>{openId === key ? 'Close' : 'Open'}</button>
            </div>

            {openId === key && (
              <div className="rq-detail">
                {src ? <video src={src} controls preload="metadata" /> : item.kind === 'channel' ? <p className="adm-empty">Loading preview…</p> : null}
                {item.description && <p>{item.description}</p>}
                <div className="rq-kv">
                  {Object.entries(item.meta).filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object').map(([k, v]) => (
                    <FragmentRow key={k} k={k} v={v} />
                  ))}
                </div>
                {item.kind !== 'ad' && (
                  rejectingId === key ? (
                    <div>
                      <input className="rq-reason" type="text" placeholder="Reason (shown to the submitter)" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div className="rq-acts" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="rq-btn rq-btn-danger" onClick={() => decide(item, 'reject', { reason })} disabled={busy || !reason.trim()}>Confirm rejection</button>
                        <button type="button" className="rq-btn" onClick={() => { setRejectingId(null); setReason(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rq-btn rq-btn-danger" onClick={() => setRejectingId(key)} disabled={busy}>Reject…</button>
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
  const label = { contentType: 'Type', hasCaptions: 'Captions', durationSeconds: 'Duration', budgetTotalCents: 'Budget', clickUrl: 'Click URL' }[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  let value = v;
  if (k === 'hasCaptions') value = v ? 'Yes' : 'No';
  if (k === 'durationSeconds') value = `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  if (k === 'budgetTotalCents') value = `$${(v / 100).toFixed(2)}`;
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
