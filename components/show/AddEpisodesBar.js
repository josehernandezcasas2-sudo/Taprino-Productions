import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FILES_PER_DROP, planBatch, positionsFor } from '../../lib/showRules';
import { CloseIcon, LinkIcon, PlusIcon, WarningIcon } from '../PlayerIcons';
import { UploadIcon, bytesShort, pickerKeys, trapTab } from './roomBits';

// The show page's Add bar and everything around adding (series revamp
// slice 2; spec Screens, "Show page", amendments 1, 8, 10, 12; decision 8;
// boards Main and AddSeveral): "+ Add episode" (the three-step submit page,
// prefilled with the show, the season and the next free number), "+ Add
// several" (the drop zone at the foot of a season: up to 30 files, each a
// draft at once, uploading one after another), "Paste a link" (a video
// link, or an MP3 link for a podcast) and, for a podcast, "Import from an
// RSS feed". Under it, while files upload, one compact row per file and the
// banner to keep the tab open. Presentational; ShowControlRoom does the
// requests and holds the upload queue (contexts/UploadContext.js).

export const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';

// A sheet: a bottom sheet on a phone, a dialog from 900px (the Move sheet's
// frame, .show-sheet).
export function RoomSheet({ title, eyebrow = null, onClose, children, foot = null, wide = false, label = null }) {
  const uid = useId();
  const panelRef = useRef(null);
  // Escape closes; the sheet takes the focus once, when it opens (a field
  // with autoFocus keeps it), and hands it back to what opened it. The
  // room re-renders all the time (uploads, polls) with a new onClose each
  // time: read through a ref, so a re-render never pulls the focus back.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null));
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`show-sheet show-room-sheet ${wide ? 'is-wide' : ''}`}>
      <button type="button" className="show-sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="show-sheet-panel" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} aria-label={label || undefined} tabIndex={-1} ref={panelRef} onKeyDown={(e) => trapTab(e, panelRef.current)}>
        <span className="show-sheet-grab" aria-hidden="true" />
        <div className="show-sheet-head">
          <div>
            {eyebrow ? <span className="show-ed-eyebrow">{eyebrow}</span> : null}
            <h2 className="show-sheet-title" id={`${uid}-t`}>{title}</h2>
          </div>
          <button type="button" className="show-ed-close" aria-label="Close" onClick={onClose}><CloseIcon size={16} /></button>
        </div>
        <div className="show-sheet-body">{children}</div>
        {foot ? <div className="show-sheet-foot">{foot}</div> : null}
      </div>
    </div>
  );
}

function filesOf(list) {
  return Array.from(list || []).filter((f) => f && typeof f.name === 'string');
}

// The drop zone at the foot of a season: drop files on it or pick them.
export function DropZone({ season, label, disabled = false, disabledLine = null, onFiles, onClose = null, autoFocus = false }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const id = useId();
  // Opened by "Add several" (or a new show's arrival): in view, and the
  // keyboard on "Pick files" — it is otherwise after every row of the show.
  useEffect(() => {
    if (!autoFocus || !inputRef.current || !inputRef.current.parentNode) return;
    inputRef.current.parentNode.scrollIntoView({ block: 'nearest' });
    inputRef.current.parentNode.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div
      className={`show-drop ${over ? 'is-over' : ''} ${disabled ? 'is-off' : ''}`}
      data-drop-season={season}
      onDragOver={(e) => { if (disabled) return; if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); setOver(false); const files = filesOf(e.dataTransfer.files); if (files.length) onFiles(files, season); }}
    >
      <span className="show-drop-icon" aria-hidden="true"><UploadIcon size={20} /></span>
      <p className="show-drop-title">Drop episodes for {label || `Season ${season}`}</p>
      <p className="show-drop-sub">Up to {FILES_PER_DROP} files at a time · they upload one after another</p>
      {disabled ? <p className="show-drop-off">{disabledLine}</p> : (
        <label className="apl-btn-secondary show-drop-pick" htmlFor={`${id}-files`} role="button" {...pickerKeys()}>
          Pick files
          <input ref={inputRef} id={`${id}-files`} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => { const files = filesOf(e.target.files); e.target.value = ''; if (files.length) onFiles(files, season); }} />
        </label>
      )}
      {onClose && <button type="button" className="apl-link show-drop-close" onClick={onClose}>Close</button>}
    </div>
  );
}

function speedLine(active) {
  if (!active || !active.startedAt || !active.fileSize) return { speed: null, eta: null };
  const secs = Math.max(1, (Date.now() - active.startedAt) / 1000);
  const rate = active.bytesUploaded / secs;
  if (!(rate > 0)) return { speed: null, eta: null };
  const left = Math.max(0, active.fileSize - active.bytesUploaded) / rate;
  const mb = rate / (1024 * 1024);
  const eta = left < 60 ? `${Math.max(1, Math.round(left))} s left` : `${Math.round(left / 60)} min left`;
  return { speed: mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round(rate / 1024))} KB/s`, eta };
}

// What the queue says about one draft: { status, pct, eta, after, error }.
export function uploadsFor(queue, active, showId) {
  const out = {};
  const mine = (queue || []).filter((it) => it.showId === showId);
  let before = null;
  for (const it of mine) {
    if (!['queued', 'starting', 'uploading', 'stopped', 'uploaded'].includes(it.status)) continue;
    const isActive = active && active.queue && active.queue.key === it.key;
    const pct = isActive && active.fileSize ? Math.round((active.bytesUploaded / active.fileSize) * 100) : it.status === 'uploaded' ? 100 : 0;
    const { speed, eta } = isActive ? speedLine(active) : { speed: null, eta: null };
    out[it.draftId] = { key: it.key, status: it.status, pct, speed, eta, after: it.status === 'queued' && before ? before : null, error: it.error || null, name: it.file ? it.file.name : null, bytes: it.file ? it.file.size : null, label: it.label || null };
    if (['queued', 'starting', 'uploading'].includes(it.status)) before = it.label || (it.file ? it.file.name : null);
  }
  return out;
}

// The upload in progress in full; the next ones as short lines (two, the
// rest folded behind "N more queued" — every row of the season says Queued
// too, so thirty files aren't listed twice).
const QUEUED_SHOWN = 2;

export function QueuePanel({ items, paused, stopped, onRetry, onResumeFiles }) {
  const [all, setAll] = useState(false);
  const live = items.filter((it) => ['queued', 'starting', 'uploading'].includes(it.status));
  const stoppedHere = items.filter((it) => it.status === 'stopped');
  if (!live.length && !stoppedHere.length && !stopped && !paused) return null;
  const moving = live.filter((it) => it.status !== 'queued');
  const waiting = live.filter((it) => it.status === 'queued');
  const shown = all ? waiting : waiting.slice(0, QUEUED_SHOWN);
  const more = waiting.length - shown.length;
  return (
    <div className="show-queue" aria-live="polite">
      {moving.map((it) => (
        <div key={it.key} className="apl-progress show-queue-row" data-queue-status={it.status}>
          <div className="apl-progress-row">
            <span className="apl-progress-name">{it.label || it.name}{it.label && it.name ? <span className="show-queue-file"> · {it.name}</span> : null} · uploading</span>
            <span aria-hidden="true">{`${it.pct || 0}%`}</span>
          </div>
          <div className="apl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={it.pct || 0} aria-label={`${it.label || it.name || 'The file'}, uploading`}><div className="apl-bar-fill" style={{ width: `${Math.max(2, it.pct || 0)}%` }} /></div>
          <div className="apl-progress-meta" aria-hidden="true"><span>{it.speed || (it.status === 'starting' ? 'Starting…' : '')}</span><span>{it.eta || ''}</span></div>
        </div>
      ))}
      {shown.length > 0 && (
        <ol className="show-queue-next">
          {shown.map((it) => {
            const before = live[live.indexOf(it) - 1];
            return (
              <li key={it.key} className="show-queue-row is-queued" data-queue-status="queued">
                <span className="show-queue-name">{it.label || it.name}{it.label && it.name ? <span className="show-queue-file"> · {it.name}</span> : null}</span>
                <span className="show-queue-when">{before ? `after ${before.label || before.name}` : 'starts in a moment'}</span>
                <span className="show-queue-state">Queued</span>
              </li>
            );
          })}
        </ol>
      )}
      {(more > 0 || (all && waiting.length > QUEUED_SHOWN)) && (
        <button type="button" className="apl-link show-queue-more" aria-expanded={all} onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `${more} more queued — they start one after another`}
        </button>
      )}
      {stoppedHere.map((it) => (
        <div key={it.key} className="apl-progress is-error show-queue-row" data-queue-status="stopped">
          <div className="apl-progress-row"><span className="apl-progress-name">{it.label || it.name}</span><span>Stopped</span></div>
          <div className="apl-progress-meta"><span>{it.error || 'The upload stopped.'}</span></div>
        </div>
      ))}
      {paused && (
        <p className="show-queue-paused" role="alert"><WarningIcon size={14} /> <span>Uploads paused: {paused}</span> <button type="button" className="apl-link" onClick={onRetry}>Try again</button></p>
      )}
      {!paused && stoppedHere.length > 0 && (
        <p className="show-queue-paused"><span>{stoppedHere.length === 1 ? 'One upload stopped.' : `${stoppedHere.length} uploads stopped.`}</span> <button type="button" className="apl-link" onClick={onRetry}>Try again</button></p>
      )}
      {stopped > 0 && live.length === 0 && (
        <label className="show-queue-resume" role="button" {...pickerKeys()}>
          <span>{stopped === 1 ? 'An upload stopped before it finished.' : `${stopped} uploads stopped before they finished.`} Pick the same file{stopped === 1 ? '' : 's'} to resume.</span>
          <span className="apl-btn-secondary show-mini">Pick files</span>
          <input type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => { const files = filesOf(e.target.files); e.target.value = ''; if (files.length) onResumeFiles(files); }} />
        </label>
      )}
      {live.length > 0 && (
        <p className="show-queue-banner" role="status"><WarningIcon size={15} /> Keep this tab open until the uploads finish</p>
      )}
    </div>
  );
}

export default function AddEpisodesBar({ view, ctx, onAddSeveral, onLink, onRss }) {
  const show = view.show;
  const podcast = show.kind === 'podcast';
  const bar = view.addBar || {};
  const submit = ctx.submitHref({ season: ctx.lastSeason, number: ctx.nextFree(ctx.lastSeason) });
  if (!ctx.canAdd) {
    if (!ctx.closedLine) return null;
    return <p className="show-addbar-closed"><WarningIcon size={14} /> {ctx.closedLine}</p>;
  }
  const behind116 = bar.drafts116 === false;
  return (
    <div className="show-addbar">
      <a className="apl-btn show-add-primary" href={submit}><PlusIcon size={17} /> Add episode</a>
      <div className="show-add-row">
        <button type="button" className="apl-btn-secondary show-add-btn" disabled={behind116} onClick={onAddSeveral}><PlusIcon size={15} /> Add several</button>
        <button type="button" className="apl-btn-secondary show-add-btn" disabled={behind116} onClick={onLink}><LinkIcon size={15} /> {podcast ? 'Paste an MP3 link' : 'Paste a link'}</button>
        {podcast && <button type="button" className="apl-btn-secondary show-add-btn" onClick={onRss}>Import from an RSS feed</button>}
      </div>
      {podcast && !behind116 && <p className="show-add-note">Audio comes in by an MP3 link or a feed; a video podcast&rsquo;s files can be dropped like any episode.</p>}
      {behind116 && (
        <div className="show-add-behind" role="status">
          <p>Adding episodes here needs a database update (migration 116)</p>
          <a className="apl-link" href={`/creator/submit?type=${podcast ? 'podcast' : 'series'}&series=${encodeURIComponent(show.id)}`}>Submit one at a time instead</a>
        </div>
      )}
      {bar.draftsUsed > bar.draftsCap - 10 && !behind116 && <p className="show-add-note">You have {bar.draftsUsed} of {bar.draftsCap} drafts — send or discard some to add more.</p>}
    </div>
  );
}

// "Add 6 episodes to Night Bus": the plan before anything is made — the
// season, each file's number (a number in its name kept when free, the rest
// next free in file-name or date order), the ones that fill a gap or land
// past a taken number. Files that are a stopped draft's own resume it.
export function AddSeveralSheet({ files, resumes = [], season, seasons, rows, showName, onSeason, onConfirm, onClose, busy, error }) {
  const [sortBy, setSortBy] = useState('name');
  const kept = files.slice(0, FILES_PER_DROP);
  const over = files.length - kept.length;
  const plan = useMemo(() => planBatch(kept.map((f) => ({ name: f.name, lastModified: f.lastModified })), { season, rows, sortBy, showName }), [kept, season, rows, sortBy, showName]);
  const gaps = useMemo(() => {
    const out = new Map();
    for (const s of new Set(plan.items.map((p) => p.season))) out.set(s, positionsFor(rows, s).gaps);
    return out;
  }, [plan, rows]);
  const holderOf = (s, n) => {
    const r = (rows || []).find((x) => (Number(x.season) || 1) === s && Number(x.seriesOrder) === n && x.status !== 'rejected');
    return r ? r.displayTitle || r.title || null : null;
  };
  const count = plan.items.filter((p) => p.seriesOrder).length;
  const nextSeason = Math.max(0, ...seasons.map((s) => s.number)) + 1;
  return (
    <RoomSheet
      title={`Add ${count} episode${count === 1 ? '' : 's'} to ${showName}`}
      onClose={onClose}
      wide
      foot={(
        <>
          <p className="show-sheet-small">Up to {FILES_PER_DROP} files at a time · they upload one after another · keep this tab open</p>
          {error && <p className="show-ed-error" role="alert">{error}</p>}
          <div className="show-sheet-actions">
            <button type="button" className="apl-btn" disabled={busy || count === 0} onClick={() => onConfirm({ files: kept, sortBy })}>{busy ? 'Adding…' : `Add ${count} episode${count === 1 ? '' : 's'}`}</button>
            <button type="button" className="apl-btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    >
      <div className="show-sheet-block">
        <span className="show-ed-label">Season</span>
        <div className="show-ed-chips" role="radiogroup" aria-label="Season">
          {seasons.map((s) => (
            <button key={s.number} type="button" role="radio" aria-checked={season === s.number ? 'true' : 'false'} className={`show-ed-chip ${season === s.number ? 'on' : ''}`} onClick={() => onSeason(s.number)}>{s.label || `Season ${s.number}`}</button>
          ))}
          <button type="button" role="radio" aria-checked={season === nextSeason ? 'true' : 'false'} className={`show-ed-chip is-new ${season === nextSeason ? 'on' : ''}`} onClick={() => onSeason(nextSeason)}>+ Season {nextSeason}</button>
        </div>
      </div>
      <div className="show-sheet-block">
        <span className="show-ed-label">Order</span>
        <div className="show-ed-chips" role="radiogroup" aria-label="Number them by">
          {[['name', 'File name'], ['date', 'Date']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={sortBy === v ? 'true' : 'false'} className={`show-ed-chip ${sortBy === v ? 'on' : ''}`} onClick={() => setSortBy(v)}>{l}</button>
          ))}
        </div>
        <p className="show-sheet-help">A number in a file&rsquo;s name is kept when it is free; the rest take the next free numbers, in {sortBy === 'date' ? 'date' : 'file-name'} order. You can change any number before sending.</p>
      </div>
      {resumes.length > 0 && (
        <p className="show-sheet-help is-ok">{resumes.length === 1 ? `${resumes[0].file.name} resumes its draft (${resumes[0].row.code || 'a draft'}).` : `${resumes.length} files resume their drafts.`}</p>
      )}
      <ol className="show-batch">
        {plan.items.map((p) => {
          const fills = p.seriesOrder && (gaps.get(p.season) || []).some((g) => p.seriesOrder >= g.from && p.seriesOrder <= g.to);
          const taken = p.note && /is taken/.test(p.note) ? Number((/E(\d+) is taken/.exec(p.note) || [])[1]) : null;
          return (
            <li key={p.index} className={`show-batch-row ${p.note ? 'has-note' : ''}`}>
              <span className="show-batch-file">{p.name}</span>
              <span className="show-batch-line">
                <span className="show-batch-arrow" aria-hidden="true">→</span>
                <span className={`show-batch-n ${p.note ? 'is-warn' : ''}`}>{p.seriesOrder ? `${p.season !== season ? `S${p.season} ` : ''}E${p.seriesOrder}` : '—'}</span>
                <span className="show-batch-title">{p.title || (p.seriesOrder ? `Episode ${p.seriesOrder}` : 'Untitled')}</span>
                {fills && <span className="show-batch-chip">Fills the gap</span>}
              </span>
              {p.note && (
                <span className="show-batch-note"><WarningIcon size={13} /> {taken && p.seriesOrder ? `E${taken} is taken${holderOf(p.season, taken) ? ` by ${holderOf(p.season, taken)}` : ''} — this one goes to E${p.seriesOrder}` : p.note}</span>
              )}
            </li>
          );
        })}
      </ol>
      {over > 0 && <p className="show-sheet-help is-warn">Up to {FILES_PER_DROP} files at a time — {over} more {over === 1 ? 'wasn’t' : 'weren’t'} added; drop {over === 1 ? 'it' : 'them'} after these.</p>}
    </RoomSheet>
  );
}

// "Paste a link" (a video link) or "Paste an MP3 link" (a podcast).
export function LinkSheet({ podcast, showName, onSubmit, onClose, busy, error }) {
  const [url, setUrl] = useState('');
  const id = useId();
  return (
    <RoomSheet
      title={podcast ? 'Paste an MP3 link' : 'Paste a link'}
      eyebrow={showName}
      onClose={onClose}
      foot={(
        <>
          {error && <p className="show-ed-error" role="alert">{error}</p>}
          <div className="show-sheet-actions">
            <button type="button" className="apl-btn" disabled={busy || !/^https?:\/\/\S+$/i.test(url.trim())} onClick={() => onSubmit(url.trim())}>{busy ? 'Fetching it…' : 'Add it as a draft'}</button>
            <button type="button" className="apl-btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    >
      <div className="show-sheet-block">
        <label className="show-ed-label" htmlFor={`${id}-url`}>{podcast ? 'The MP3’s address' : 'The video’s address'}</label>
        <input id={`${id}-url`} className="show-ed-input" type="url" inputMode="url" autoFocus placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy && /^https?:\/\/\S+$/i.test(url.trim())) onSubmit(url.trim()); }} />
        <p className="show-sheet-help">{podcast ? 'We fetch the file and it lands as a draft at the next free number. Send it for review from its row.' : 'A direct link to the file (Dropbox, Google Drive, your own site). We fetch it on our side — nothing uploads from this tab — and it lands as a draft at the next free number.'}</p>
      </div>
    </RoomSheet>
  );
}

// "Import from an RSS feed" (a podcast): read the feed, tick the episodes,
// import them into this show (each goes to review like any episode).
export function RssSheet({ showName, onPreview, onImport, onClose }) {
  const [feed, setFeed] = useState('');
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const id = useId();
  async function read() {
    setBusy('read');
    setError(null);
    const r = await onPreview(feed.trim());
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
    setPicked(new Set((r.data.episodes || []).map((x) => x.guid)));
    return null;
  }
  async function go() {
    setBusy('import');
    setError(null);
    const list = (preview.episodes || []).filter((x) => picked.has(x.guid));
    const r = await onImport(list);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
    return null;
  }
  const eps = preview ? preview.episodes || [] : [];
  return (
    <RoomSheet
      title="Import from an RSS feed"
      eyebrow={showName}
      wide
      onClose={onClose}
      foot={(
        <>
          {error && <p className="show-ed-error" role="alert">{error}</p>}
          {result ? (
            <div className="show-sheet-actions"><button type="button" className="apl-btn" onClick={onClose}>Done</button></div>
          ) : preview ? (
            <div className="show-sheet-actions">
              <button type="button" className="apl-btn" disabled={busy === 'import' || picked.size === 0} onClick={go}>{busy === 'import' ? 'Importing…' : `Import ${picked.size} episode${picked.size === 1 ? '' : 's'}`}</button>
              <button type="button" className="apl-btn-secondary" onClick={() => { setPreview(null); setResult(null); }}>Another feed</button>
            </div>
          ) : (
            <div className="show-sheet-actions">
              <button type="button" className="apl-btn" disabled={busy === 'read' || !/^https?:\/\/\S+$/i.test(feed.trim())} onClick={read}>{busy === 'read' ? 'Reading the feed…' : 'Read the feed'}</button>
              <button type="button" className="apl-btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          )}
        </>
      )}
    >
      {!preview && (
        <div className="show-sheet-block">
          <label className="show-ed-label" htmlFor={`${id}-feed`}>The feed&rsquo;s address</label>
          <input id={`${id}-feed`} className="show-ed-input" type="url" inputMode="url" autoFocus placeholder="https://feeds.example.com/your-show.xml" value={feed} onChange={(e) => setFeed(e.target.value)} />
          <p className="show-sheet-help">Most hosts publish one. You see every episode before anything is added; each one goes to review like any episode, numbered where its own number is free and next free otherwise.</p>
        </div>
      )}
      {preview && !result && (
        <div className="show-sheet-block">
          <p className="show-sheet-help"><strong>{preview.showTitle || 'The feed'}</strong> · {eps.length} episode{eps.length === 1 ? '' : 's'} found</p>
          <div className="show-ed-chips">
            <button type="button" className="show-ed-chip" onClick={() => setPicked(new Set(eps.map((x) => x.guid)))}>All</button>
            <button type="button" className="show-ed-chip" onClick={() => setPicked(new Set())}>None</button>
          </div>
          <ul className="show-rss-list">
            {eps.map((x) => (
              <li key={x.guid}>
                <label>
                  <input type="checkbox" checked={picked.has(x.guid)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(x.guid)) n.delete(x.guid); else n.add(x.guid); return n; })} />
                  <span><strong>{x.title || 'Untitled'}</strong>{x.pubDate ? <small> · {String(x.pubDate).slice(0, 16)}</small> : null}{x.episodeNumber ? <small> · E{x.episodeNumber}</small> : null}{x.sizeBytes ? <small> · {bytesShort(x.sizeBytes)}</small> : null}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div className="show-sheet-block">
          <p className="show-sheet-help is-ok"><strong>{result.imported || 0} imported</strong>{result.imported ? ' — they’re in review now.' : '.'}</p>
          {(result.skipped || []).length > 0 && <ul className="show-sheet-lines">{result.skipped.map((s, i) => <li key={i}>{s.title}: {s.reason}</li>)}</ul>}
          {(result.failed || []).length > 0 && <ul className="show-sheet-lines">{result.failed.map((s, i) => <li key={i}>{s.title || 'An episode'}: {s.error || s.reason || 'could not be imported'}</li>)}</ul>}
        </div>
      )}
    </RoomSheet>
  );
}
