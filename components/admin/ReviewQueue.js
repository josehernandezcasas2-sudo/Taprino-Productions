import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminReviewAdModal from '../AdminReviewAdModal';

const KIND_LABEL = { submission: 'Episode', ad: 'Ad', channel: 'Channel upload', location: 'Place', price: 'Price', application: 'Application' };

// A show episode's eyebrow, by where its show stands (lib/reviewQueue.js
// meta.show.stage).
const STAGE_EYEBROW = {
  new: { text: 'New show', tone: '' },
  private: { text: 'Show · not public yet', tone: '' },
  live: { text: 'Show · live', tone: 'is-ok' },
  pulled: { text: 'Show · pulled', tone: 'is-danger' },
  removal: { text: 'Show · removal requested', tone: 'is-muted' }
};

const FILE_WORDS = { ready: 'ready', audio: 'audio', external: 'ready (its own address)', processing: 'still processing', uploading: 'still uploading', error: 'failed to process', deleted: 'gone from Cloudflare', none: 'no file yet', unknown: 'not checked yet' };

function ageWords(days) {
  const n = Number(days);
  if (days === null || days === undefined || !Number.isFinite(n) || n < 0) return null;
  if (n < 1) return 'new today';
  if (n < 60) return `${Math.floor(n)} day${Math.floor(n) === 1 ? '' : 's'} old`;
  if (n < 730) return `${Math.floor(n / 30)} months old`;
  return `${Math.floor(n / 365)} years old`;
}

// "S1 E1–E12" from the items' places.
function codesLine(codes) {
  const bySeason = new Map();
  for (const c of codes) {
    const m = /^S(\d+)\s+E(\d+)$/.exec(String(c || ''));
    if (!m) continue;
    const s = Number(m[1]);
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push(Number(m[2]));
  }
  const out = [];
  for (const s of [...bySeason.keys()].sort((a, b) => a - b)) {
    const nums = [...new Set(bySeason.get(s))].sort((a, b) => a - b);
    const runs = [];
    let start = nums[0];
    let prev = nums[0];
    for (const n of nums.slice(1)) {
      if (n === prev + 1) { prev = n; continue; }
      runs.push(start === prev ? `E${start}` : `E${start}–E${prev}`);
      start = n;
      prev = n;
    }
    runs.push(start === prev ? `E${start}` : `E${start}–E${prev}`);
    out.push(`S${s} ${runs.join(', ')}`);
  }
  return out.join(' · ');
}

// Consecutive submissions of one show draw under one header (the server
// puts a show's episodes together, in play order).
// A show's header: the episodes shown here, and how many of its episodes
// are in review in all (the dashboard shows only the first few).
function groupLine(block) {
  const shown = block.items.length;
  const show = block.items[0] && block.items[0].meta ? block.items[0].meta.show : null;
  const total = Math.max(shown, show && Number.isFinite(Number(show.waitingCount)) ? Number(show.waitingCount) + 1 : 0);
  const codes = codesLine(block.items.map((i) => i.meta.position));
  if (total > shown) return [codes ? `${codes} shown` : `${shown} shown`, `${total} in review`].join(' · ');
  return [codes, `${shown} in review`].filter(Boolean).join(' · ');
}

function withGroups(list) {
  const out = [];
  for (const item of list) {
    const sid = item.kind === 'submission' && item.meta && item.meta.show ? item.meta.show.id : null;
    const last = out[out.length - 1];
    if (sid && last && last.group && last.group.id === sid) last.items.push(item);
    else if (sid) out.push({ group: item.meta.show, items: [item] });
    else out.push({ group: null, items: [item] });
  }
  return out;
}

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
//
// A show's episode (the series revamp, slice 3a) carries its show: the
// episodes of one show sit together under a header with "Open show page",
// each says where the show stands, its place and whether the number is
// free, and Approve is off (with the reason) while its number is taken or
// missing or its file isn't ready. Approving one never makes the show
// public: its owner does that (decision 2), so the old "Ready to go
// public" items are gone from the queue.
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
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A refusal (a taken number, a file still processing, the show
        // pulled…): say why and show the queue as it is now.
        setError(d.error || 'Could not update this.');
        if (res.status === 409) await load();
        return;
      }
      if (item.kind === 'application' && decision === 'approve') {
        setFlash(d.mode === 'live'
          ? <>“{item.title}” is live at <Link href={d.episode.href}>{d.episode.href}</Link>{d.roleGranted ? ' and Creator Studio is granted' : ''}. They’ve been emailed.</>
          : `Accepted. Creator Studio is ${d.roleGranted ? 'granted' : 'already theirs'}; they upload the master there. They’ve been emailed.`);
      } else if (item.kind === 'submission' && decision === 'approve' && item.meta && item.meta.show && item.meta.show.makesPublic) {
        setFlash(`“${item.title}” is approved. ${item.meta.show.makesPublic}`);
      }
      setRejectingId(null);
      setHoldingId(null);
      setReason('');
      setOpenId(null);
      await load();
      window.dispatchEvent(new CustomEvent('taprino:admin-queue-changed'));
    } catch (err) {
      setError(err.message || 'Could not update this.');
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

  const items = (data.items || []).filter((i) => i.kind !== 'series' && (filter === 'all' || i.kind === filter));
  const shown = limit ? items.slice(0, limit) : items;
  const counts = data.counts || {};

  function renderItem(item, inGroup) {
    const key = `${item.kind}-${item.id}`;
    const busy = busyId === key;
    const src = item.kind === 'channel' ? previews[item.id] : item.media.src;
    const isApplication = item.kind === 'application';
    const meta = item.meta || {};
    const showInfo = item.kind === 'submission' ? meta.show || null : null;
    const eyebrow = showInfo ? STAGE_EYEBROW[showInfo.stage] || STAGE_EYEBROW.private : null;
    const blocked = item.kind === 'submission' ? meta.blocked || null : item.kind === 'application' && meta.canAccept === false ? meta.acceptBlocker || 'A full admin accepts an application.' : null;
    const tierNow = tiers[item.id] || (item.kind === 'submission' ? (meta.tier === 'premium' ? 'premium' : 'free') : 'free');
    // A submission's Approve says which file it was looking at (meta.seen):
    // a file replaced since answers 409 and the queue reloads.
    const approveExtra = item.kind === 'submission' ? { tierOverride: tierNow, ...(meta.seen ? { seen: meta.seen } : {}) } : isApplication ? { tierOverride: tierNow } : {};
    return (
      <div key={key} className={`rq-row ${inGroup ? 'rq-row-in-group' : ''}`}>
        <div className="rq-thumb" style={item.media.poster ? { backgroundImage: `url("${String(item.media.poster).replace(/"/g, '%22')}")` } : undefined}>
          {!item.media.poster && KIND_LABEL[item.kind].split(' ')[0]}
        </div>
        <div>
          <div className="rq-title">
            {eyebrow ? <span className={`rq-kind ${eyebrow.tone}`}>{eyebrow.text}</span> : <span className="rq-kind">{KIND_LABEL[item.kind]}</span>}
            {item.title}
          </div>
          <div className="rq-sub">{item.subtitle}{item.createdAt && ` · ${timeAgo(item.createdAt)}`}</div>
          {blocked && <div className="rq-blocked">{blocked}</div>}
        </div>
        <div className="rq-acts">
          {item.kind === 'ad' ? (
            <button type="button" className="rq-btn" onClick={() => setReviewingAd(item)} disabled={busy}>Review…</button>
          ) : (
            <button type="button" className="rq-btn rq-btn-ok" onClick={() => decide(item, 'approve', approveExtra)} disabled={busy || Boolean(blocked)} title={blocked || (isApplication ? (meta.masterReady ? 'Puts it live now and grants Creator Studio' : 'Grants Creator Studio') : undefined)}>
              {busy ? 'Working…' : isApplication ? (meta.masterReady ? 'Accept · live' : 'Accept') : 'Approve'}
            </button>
          )}
          <button type="button" className="rq-btn" onClick={() => toggleOpen(item)}>{openId === key ? 'Close' : 'Open'}</button>
        </div>

        {openId === key && (
          <div className="rq-detail">
            {item.media.iframe
              ? <iframe src={item.media.iframe} title={`${item.title} — the master`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
              : src ? <video src={src} controls preload="metadata" />
                : item.media.audio ? <audio src={item.media.audio} controls preload="none" className="rq-audio" />
                  : item.kind === 'channel' ? <p className="adm-empty">Loading preview…</p>
                    : isApplication ? <p className="adm-empty">{meta.masterReady ? 'The master could not be signed for playback.' : meta.filesLink ? 'No upload; open their link below.' : 'The master is not ready to play yet (still uploading or processing). Reload in a few minutes.'}</p>
                      : item.kind === 'submission' && meta.master && meta.master !== 'ready' && meta.masterReady === false ? <p className="adm-empty">The file is {FILE_WORDS[meta.master] || 'not ready'} — it plays here once it’s ready.</p>
                        : item.kind === 'submission' && meta.openOnShowPage && showInfo ? <p className="adm-empty">Too many to play here at once — <Link href={showInfo.href}>open it on the show page</Link>.</p>
                          : item.kind === 'submission' && meta.openOnShowPage ? <p className="adm-empty">Too many to play here at once — reload the queue once a few are decided.</p>
                            : null}
            {showInfo && (
              <div className="rq-show">
                <span className="rq-show-poster" style={showInfo.poster ? { backgroundImage: `url("${String(showInfo.poster).replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
                <div className="rq-show-body">
                  <span className={`rq-kind ${eyebrow ? eyebrow.tone : ''}`}>{eyebrow ? eyebrow.text : 'Show'}</span>
                  <strong className="rq-show-name">{showInfo.name || 'A show'} <em>{showInfo.kind === 'podcast' ? 'Podcast' : showInfo.kind === 'vertical' ? 'Vertical' : 'Series'}</em></strong>
                  <span className="rq-show-by">{[showInfo.ownerName ? `by ${showInfo.ownerName}` : 'No one runs it yet', ageWords(showInfo.ownerAccountAgeDays) ? `account ${ageWords(showInfo.ownerAccountAgeDays)}` : null].filter(Boolean).join(' · ')}</span>
                  {showInfo.description ? <p className="rq-show-desc">{showInfo.description}</p> : null}
                  {showInfo.defaultsLine ? <span className="rq-show-line">{showInfo.defaultsLine}</span> : null}
                  {showInfo.waitingCount > 0 ? <span className="rq-show-line">{showInfo.waitingCount} more episode{showInfo.waitingCount === 1 ? '' : 's'} waiting</span> : null}
                  {showInfo.makesPublic ? <span className="rq-show-line is-note">{showInfo.makesPublic}</span> : null}
                  <Link href={showInfo.href} className="rq-show-link">Open show page →</Link>
                </div>
              </div>
            )}
            {meta.slot && meta.slot.words ? <p className={`rq-slot ${meta.slot.free ? 'is-free' : 'is-taken'}`}>{meta.slot.words}</p> : null}
            {item.description && <p>{item.description}</p>}
            {(isApplication || item.kind === 'submission') && (
              <label className="rq-tier">
                Who can watch
                <select value={tierNow} onChange={(e) => setTiers((t) => ({ ...t, [item.id]: e.target.value }))}>
                  <option value="free">Free with ads</option>
                  <option value="premium">Tapa + members</option>
                </select>
              </label>
            )}
            <div className="rq-kv">
              {Object.entries(meta).filter(([k, v]) => !HIDDEN_META.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object' && typeof v !== 'boolean').map(([k, v]) => (
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
  }

  return (
    <div>
      {!compact && (
        <div className="rq-filters">
          {[['all', 'All', counts.total], ['application', 'Applications', counts.application], ['submission', 'Episodes', counts.submission], ['ad', 'Ads', counts.ad], ['channel', 'Channel uploads', counts.channel], ['location', 'Places', counts.location], ['price', 'Prices', counts.price]].map(([k, label, n]) => (
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
      ) : withGroups(shown).map((block) => (block.group && block.items.length > 1 ? (
        <section key={`group-${block.group.id}-${block.items[0].id}`} className="rq-group" aria-label={block.group.name || 'A show'}>
          <header className="rq-group-head">
            <span className="rq-group-poster" style={block.group.poster ? { backgroundImage: `url("${String(block.group.poster).replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
            <div className="rq-group-text">
              <strong>{block.group.name || 'A show'}</strong>
              <span>{groupLine(block)}</span>
            </div>
            <Link href={block.group.href} className="rq-group-link">Open show page →</Link>
          </header>
          {block.items.map((item) => renderItem(item, true))}
        </section>
      ) : block.items.map((item) => renderItem(item, false))))}
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

// Meta the card already says in its own words.
const HIDDEN_META = new Set(['blocked', 'masterReady', 'openOnShowPage', 'tier', 'seen', 'canAccept', 'acceptBlocker']);

function FragmentRow({ k, v }) {
  const label = { contentType: 'Type', hasCaptions: 'Captions', durationSeconds: 'Duration', budgetTotalCents: 'Budget', clickUrl: 'Click URL', proofUrl: 'Proof', listingUrl: 'Listing', hostSays: 'Host says', filesLink: 'Their files', goesLive: 'Accept means', approvedCount: 'Approved episodes', position: 'Place', master: 'The file' }[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  let value = v;
  if (k === 'hasCaptions') value = v ? 'Yes' : 'No';
  if (k === 'durationSeconds') value = `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  if (k === 'budgetTotalCents') value = `$${(v / 100).toFixed(2)}`;
  if (k === 'master') value = FILE_WORDS[v] || v;
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

