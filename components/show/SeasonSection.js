import { useEffect, useRef, useState } from 'react';
import { rowPill } from '../../lib/showRules';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ExternalLinkIcon, LockIcon, PencilIcon, TrashIcon, WarningIcon } from '../PlayerIcons';
import { ChevronIcon, GripIcon, KebabIcon, SendIcon, ago, bg, bytesShort, minutesOf, pickerKeys } from './roomBits';

// A season of the show page (series revamp slice 2; spec Screens, "Show
// page", boards Main, ShowLaptop, ShowLaptopDrag, ShowStates): the header
// (the label, the count, "Send N for review", the kebab: rename, Renumber
// from 1…, the next season), its rows in play order — episodes, the
// viewer's drafts and dashed gap rows — and, when the room opens it, the
// drop zone at its foot. Presentational: the room (ShowControlRoom) owns
// the data and every request; this draws and calls back.
//
// A row: ↑/↓ (a phone, or anything without a fine pointer) or the grip ⋮⋮
// (a mouse: drag, or the ↑/↓ keys on the focused grip), the E-badge (tap →
// type a number; a taken one offers Swap | Insert here), the 16:9 thumb
// (its own still, else the show's), the title (or "Episode N"), the pill
// (lib/showRules.js rowPill) and the meta line, the kebab. A tap on the
// row opens the editor.
//
// On Admin → Shows (ctx.admin, slice 3a §5.3) a row in review also gets
// Approve (with Free / Tapa +) and Reject… under it, "Use E9" when its
// number is taken or missing (manage_episodes), and the line that stops it
// being approved; a row whose removal is asked gets Confirm removal / Keep
// it (manage_deletions); the kebab adds the Library's edit modal and, on a
// live row, its ad plan.

function RowMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  // Escape, or picking an item, puts the focus back on the kebab (the item
  // is about to go): what an item opens (the Move sheet) then hands the
  // focus back to the kebab when it closes.
  const back = () => { if (btnRef.current) btnRef.current.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (ref.current && ref.current.contains(document.activeElement)) back();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return <span className="show-kebab-space" aria-hidden="true" />;
  return (
    <div className="show-kebab-wrap" ref={ref}>
      <button type="button" ref={btnRef} className="show-kebab" aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'} aria-label={label} onClick={() => setOpen((v) => !v)}>
        <KebabIcon size={18} />
      </button>
      {open && (
        <div className="show-menu" role="menu">
          {shown.map((it, i) => (it.divider ? <hr key={`d${i}`} /> : it.href ? (
            <a key={it.key || it.label} role="menuitem" className={`show-menu-item ${it.danger ? 'is-danger' : ''}`} href={it.href} target={it.external ? '_blank' : undefined} rel={it.external ? 'noopener noreferrer' : undefined} onClick={() => setOpen(false)}>
              {it.icon}<span>{it.label}</span>{it.note ? <em>{it.note}</em> : null}
            </a>
          ) : it.pick ? (
            <label key={it.key || it.label} role="menuitem" className="show-menu-item" {...pickerKeys()}>
              {it.icon}<span>{it.label}</span>
              <input type="file" accept={it.accept} hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; setOpen(false); back(); if (f) it.pick(f); }} />
            </label>
          ) : (
            <button key={it.key || it.label} type="button" role="menuitem" className={`show-menu-item ${it.danger ? 'is-danger' : ''}`} disabled={it.disabled} onClick={(e) => { setOpen(false); back(); it.onClick(e); }}>
              {it.icon}<span>{it.label}</span>{it.note ? <em>{it.note}</em> : null}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

// The E-badge: tap → a number field; Enter keeps it, Escape leaves it.
function NumberBadge({ row, editable, onCommit, title }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);
  const label = row.seriesOrder ? `E${row.seriesOrder}` : 'E–';
  if (!editable) return <span className="show-ebadge is-static" title={title || undefined}>{label}</span>;
  if (!editing) {
    return (
      <button type="button" className="show-ebadge" aria-label={`${row.code || label}: change the number`} title="Change the number" onClick={() => { setValue(row.seriesOrder ? String(row.seriesOrder) : ''); setEditing(true); }}>
        {label}
      </button>
    );
  }
  const done = (keep) => {
    setEditing(false);
    const n = Number(value);
    if (keep && Number.isInteger(n) && n > 0 && n !== row.seriesOrder) onCommit(n);
  };
  return (
    <span className="show-ebadge is-editing">
      <span aria-hidden="true">E</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        maxLength={4}
        aria-label="Episode number"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); done(true); }
          if (e.key === 'Escape') { e.preventDefault(); done(false); }
        }}
        onBlur={() => done(true)}
      />
    </span>
  );
}

function rowMeta(row, ctx, upload) {
  const parts = [];
  if (row.kind === 'draft') {
    const runtime = minutesOf((row.video && row.video.runtimeSeconds) || (ctx.draftInfo[row.id] && ctx.draftInfo[row.id].runtime) || null);
    if (upload && (upload.status === 'uploading' || upload.status === 'starting')) {
      if (upload.eta) parts.push(upload.eta);
      else parts.push(upload.status === 'starting' ? 'starting…' : 'uploading');
    } else if (upload && upload.status === 'queued') {
      parts.push(upload.after ? `after ${upload.after}` : 'waits its turn');
    } else if (upload && upload.status === 'stopped') {
      parts.push({ warn: upload.error || 'The upload stopped — pick the same file to resume' });
    } else if (runtime) parts.push(runtime);
    if (upload && upload.status === 'uploaded' && row.master !== 'ready') {
      parts.push('uploaded · processing');
    } else if (!upload || !['queued', 'starting', 'uploading', 'stopped'].includes(upload.status)) {
      if (row.blocker && row.master === 'uploading') parts.push({ warn: 'The upload stopped — pick the same file to resume' });
      else if (row.master === 'error') parts.push({ warn: 'The file failed — replace it' });
      else if (row.master === 'none' && row.file) parts.push({ warn: 'Not uploaded yet — pick the same file to resume' });
      else if (row.master === 'none' && !(row.audio)) parts.push({ warn: 'No file yet' });
      else if (row.ready) parts.push({ ok: 'ready to send' });
      else if (row.blocker && row.master !== 'processing') parts.push({ warn: row.blocker });
    }
    return parts;
  }
  const runtime = minutesOf(row.runtime);
  if (runtime) parts.push(runtime);
  if (row.status === 'pending' && row.createdAt) parts.push(`sent ${ago(row.createdAt)}`);
  if (row.status === 'pending' && ['uploading', 'processing'].includes(row.master)) parts.push(row.master === 'uploading' ? { warn: 'the upload never finished' } : 'processing');
  if (row.master === 'error') parts.push({ warn: 'The file failed — replace it' });
  if (row.status === 'rejected' && row.rejectionReason) parts.push({ warn: row.rejectionReason });
  if (row.status === 'approved' && ctx.kind !== 'podcast' && row.hasCaptions === false) parts.push({ warn: 'Needs captions' });
  if (row.captionsStale) parts.push({ warn: 'Captions may be out of sync' });
  const st = row.staged || {};
  if (st.title) parts.push({ wait: 'Title change waiting' });
  if (st.poster || st.thumbnail || st.titleImage) parts.push({ wait: 'Art waiting for approval' });
  if (st.trailer) parts.push({ wait: 'New trailer waiting' });
  if (st.newVideo) parts.push({ wait: 'New file waiting' });
  const review = ctx.admin && row.status === 'pending' ? ctx.admin.rows[row.id] || null : null;
  if (review && review.editedAt) parts.push(`edited ${ago(review.editedAt)}`);
  // What stops Approve, unless the line above already says it (a file that
  // never finished uploading or failed).
  const saidAlready = review && review.blocked && review.blocked.code === 'master-not-ready' && ['uploading', 'error'].includes(row.master);
  if (review && review.blocked && review.blocked.line && !saidAlready) parts.push({ warn: review.blocked.line });
  if (row.hasPageChoice === true) parts.push('its own page');
  if (row.tier && ctx.defaultTier && row.tier !== ctx.defaultTier) parts.push(row.tier === 'free' ? 'free' : ctx.premiumWord);
  if (row.uploaderName) parts.push(`uploaded by ${row.uploaderName}`);
  return parts;
}

function MetaLine({ parts }) {
  if (!parts.length) return null;
  return (
    <span className="show-row-meta">
      {parts.map((p, i) => {
        // The dot trails its item, so a wrapped line never starts with one.
        const sep = i < parts.length - 1 ? <span className="show-dot" aria-hidden="true">·</span> : null;
        if (typeof p === 'string') return <span key={i}>{p}{sep}</span>;
        if (p.warn) return <span key={i}><span className="tone-warn">{p.warn}</span>{sep}</span>;
        if (p.ok) return <span key={i}><span className="tone-ok">{p.ok}</span>{sep}</span>;
        if (p.wait) return <span key={i}><span className="tone-wait">{p.wait}</span>{sep}</span>;
        return null;
      })}
    </span>
  );
}

function EpisodeRow({ row, index, count, ctx, actions }) {
  const isDraft = row.kind === 'draft';
  const upload = isDraft ? ctx.uploads[row.id] || null : null;
  const pill = rowPill(row, { showPublic: ctx.showPublic, upload: upload ? { status: upload.status, pct: upload.pct } : null });
  const openable = ctx.canOpen(row);
  const reorderable = ctx.canReorder && row.inRunningOrder !== false && row.status !== 'rejected' && !row.withdrawnAt;
  const href = openable ? ctx.paths.episode(row.id, isDraft) : null;
  const thumb = row.thumbnail || ctx.showStill || ctx.showPoster || null;
  const domId = isDraft ? `draft-${row.id}` : `ep-${row.id}`;
  const conflict = ctx.conflicts[row.id] || null;
  const note = ctx.rowNotes[row.id] || null;
  const busy = ctx.busyRow === row.id;
  const mine = row.mine || ctx.team;
  const adminReview = ctx.admin && !isDraft && row.status === 'pending' ? ctx.admin.rows[row.id] || null : null;
  const adminRemoval = Boolean(ctx.admin && !isDraft && row.deletionRequested && !row.withdrawnAt);
  const menu = [];
  if (openable) menu.push({ key: 'edit', label: 'Edit', icon: <PencilIcon size={15} />, onClick: () => actions.open(row) });
  if (ctx.canMove(row)) menu.push({ key: 'move', label: 'Move to…', icon: <ChevronIcon size={15} />, onClick: (e) => actions.openMove(row, e) });
  if (!isDraft && ctx.shows118 && (ctx.isOwner || mine) && row.status !== 'rejected') {
    menu.push({ key: 'page', label: row.hasPage ? 'Use the player only' : 'Give it its own page', icon: <ExternalLinkIcon size={15} />, onClick: () => actions.togglePage(row) });
  }
  if (!isDraft && mine && openable) {
    menu.push({ key: 'replace', label: 'Replace file', icon: <ArrowUpIcon size={15} />, onClick: () => actions.open(row) });
    if (ctx.kind !== 'podcast') menu.push({ key: 'captions', label: 'Captions', icon: <span className="show-menu-cc" aria-hidden="true">CC</span>, onClick: () => actions.open(row) });
  }
  if (!isDraft && row.status === 'approved' && ctx.showPublic && !row.held && !row.deletionRequested) menu.push({ key: 'view', label: 'View page', icon: <ExternalLinkIcon size={15} />, href: `/episode/${encodeURIComponent(row.id)}`, external: true });
  if (!isDraft && ctx.admin && ctx.admin.can && (ctx.admin.can.edit || ctx.admin.can.fullAdmin)) {
    menu.push({ key: 'library', label: 'Open in Library modal', icon: <PencilIcon size={15} />, href: `/admin/library?edit=${encodeURIComponent(row.id)}` });
    if (row.status === 'approved') menu.push({ key: 'adplan', label: 'Ad plan', icon: <ExternalLinkIcon size={15} />, href: `/ad-plan/${encodeURIComponent(row.id)}` });
  }
  if (isDraft && row.mine) {
    const stopped = (upload && upload.status === 'stopped') || row.master === 'uploading' || row.master === 'none' || row.master === 'error';
    if (stopped && !(upload && ['queued', 'starting', 'uploading'].includes(upload.status))) {
      menu.push({ key: 'pick', label: row.master === 'none' ? 'Pick the file' : 'Pick the same file to resume', icon: <ArrowUpIcon size={15} />, accept: 'video/*,.mp4,.mov,.m4v,.mkv,.webm', pick: (f) => actions.pickFile(row, f) });
    }
    menu.push({ divider: true });
    menu.push({ key: 'discard', label: 'Discard', icon: <TrashIcon size={15} />, danger: true, onClick: () => actions.discard(row) });
  } else if (!isDraft && row.mine && !row.deletionRequested && !row.withdrawnAt) {
    menu.push({ divider: true });
    menu.push({ key: 'remove', label: 'Remove…', icon: <TrashIcon size={15} />, danger: true, onClick: () => actions.askRemove(row) });
  }
  const pct = upload && (upload.status === 'uploading' || upload.status === 'starting') ? Math.max(2, Math.min(100, upload.pct || 0)) : null;
  const classes = ['show-row', isDraft ? 'is-draft' : '', ctx.openId === row.id ? 'is-open' : '', ctx.flashId === row.id ? 'is-flash' : '', ctx.draggingId === row.id ? 'is-drag-source' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' ');
  const main = (
    <>
      <span className="show-row-thumb" style={bg(thumb)} aria-hidden="true">
        {!thumb && <span className="show-row-thumb-name">{ctx.showName}</span>}
        {pct !== null && <span className="show-row-bar"><i style={{ width: `${pct}%` }} /></span>}
      </span>
      <span className="show-row-title">{row.displayTitle || row.title || (row.seriesOrder ? `Episode ${row.seriesOrder}` : 'Untitled')}</span>
      <span className="show-row-sub">
        {pill && <span className={`show-pill tone-${pill.tone} key-${pill.key}`}>{pill.label}</span>}
        <MetaLine parts={rowMeta(row, ctx, upload)} />
      </span>
    </>
  );
  return (
    <li id={domId} className={classes} data-row-id={row.id} data-kind={row.kind} data-sortable={reorderable ? 'true' : undefined}>
      <div className="show-row-order">
        {reorderable ? (
          <>
            {/* Off while a move is on its way or at the season's ends with
                aria-disabled, not disabled: a disabled button drops the
                focus, and a keyboard user moving a row step by step keeps it. */}
            <span className="show-row-arrows">
              <button type="button" className="show-arrow" aria-label={`Move ${row.displayTitle || 'it'} up`} disabled={!ctx.reorderOpen} aria-disabled={index === 0 || busy ? 'true' : undefined} onClick={() => { if (index > 0 && !busy) actions.moveBy(row, -1); }}><ArrowUpIcon size={14} /></button>
              <button type="button" className="show-arrow" aria-label={`Move ${row.displayTitle || 'it'} down`} disabled={!ctx.reorderOpen} aria-disabled={index >= count - 1 || busy ? 'true' : undefined} onClick={() => { if (index < count - 1 && !busy) actions.moveBy(row, 1); }}><ArrowDownIcon size={14} /></button>
            </span>
            <button
              type="button"
              className="show-grip"
              aria-label={`Drag ${row.displayTitle || 'it'} to move it, or use the arrow keys`}
              title={ctx.reorderOpen ? 'Drag to move · ↑ ↓ keys · hold Alt to swap' : ctx.reorderLine}
              disabled={!ctx.reorderOpen}
              aria-disabled={busy ? 'true' : undefined}
              onPointerDown={(e) => { if (ctx.reorderOpen && !busy) actions.startDrag(e, row); }}
              onKeyDown={(e) => {
                if (busy) return;
                if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); actions.moveBy(row, -1); }
                if (e.key === 'ArrowDown' && index < count - 1) { e.preventDefault(); actions.moveBy(row, 1); }
              }}
            >
              <GripIcon size={16} />
            </button>
          </>
        ) : <span className="show-row-order-space" aria-hidden="true" />}
      </div>
      <NumberBadge row={row} editable={reorderable && ctx.reorderOpen && !busy} title={!ctx.reorderOpen && reorderable ? ctx.reorderLine : null} onCommit={(n) => actions.setNumber(row, n)} />
      {href ? (
        <a className="show-row-main" href={href} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); actions.open(row); }}>{main}</a>
      ) : (
        <div className="show-row-main">{main}</div>
      )}
      <RowMenu items={menu} label={`More for ${row.displayTitle || 'this episode'}`} />
      {adminReview || adminRemoval ? (
        <div className="show-row-foot show-adm-rowfoot">
          {adminReview && <AdminReviewActions row={row} info={adminReview} ctx={ctx} actions={actions} busy={busy} />}
          {adminRemoval && <AdminRemovalActions row={row} ctx={ctx} actions={actions} busy={busy} />}
        </div>
      ) : null}
      {(conflict || note) && (
        <div className="show-row-foot">
          {conflict && (
            <div className="show-conflict" role="status">
              <p className="show-conflict-line"><WarningIcon size={14} /> <span><b>E{conflict.number}</b> is {conflict.holderTitle ? <b>{conflict.holderTitle}</b> : 'taken'}{conflict.choices.length ? ' —' : ''}</span></p>
              <div className="show-conflict-acts">
                {conflict.choices.includes('swap') && <button type="button" className="apl-btn-secondary show-mini" disabled={busy} onClick={() => actions.resolveConflict(row, 'swap')}>Swap</button>}
                {conflict.choices.includes('insert') && <button type="button" className="apl-btn-secondary show-mini" disabled={busy} onClick={() => actions.resolveConflict(row, 'insert')}>Insert here</button>}
                <button type="button" className="apl-link" onClick={() => actions.clearConflict(row)}>Cancel</button>
              </div>
              {conflict.lines && conflict.lines.length > 0 && <ul className="show-conflict-words">{conflict.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
            </div>
          )}
          {note && <p className={`show-row-note tone-${note.tone || 'warn'}`} role={note.tone === 'warn' ? 'alert' : 'status'}>{note.text}</p>}
        </div>
      )}
    </li>
  );
}

// Admin → Shows: Approve (with who can watch) and Reject… for a row in
// review, and "Use E9" when its place stops it (manage_episodes).
function AdminReviewActions({ row, info, ctx, actions, busy }) {
  const [tier, setTier] = useState(info.tier === 'premium' ? 'premium' : 'free');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const can = ctx.admin.can || {};
  const needs = ctx.admin.needs || {};
  const blocked = info.blocked || null;
  const placeBlock = blocked && (blocked.code === 'taken' || blocked.code === 'unnumbered');
  const free = placeBlock ? Number(blocked.nextFree) || ctx.admin.nextFree(Number(row.season) || 1) : null;
  const label = row.code || row.displayTitle || 'this episode';
  if (rejecting) {
    return (
      <form className="show-adm-rowform" onSubmit={async (e) => { e.preventDefault(); if (await actions.rejectRow(row, reason.trim())) { setRejecting(false); setReason(''); } }}>
        <label className="show-sr" htmlFor={`show-adm-reject-${row.id}`}>What needs fixing in {label}</label>
        <input id={`show-adm-reject-${row.id}`} className="show-ed-input" type="text" maxLength={1000} value={reason} placeholder="What needs fixing (they read this)" autoFocus onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setRejecting(false); setReason(''); } }} />
        <button type="submit" className="show-danger-btn show-mini" disabled={busy}>{busy ? 'Sending…' : 'Send it back'}</button>
        <button type="button" className="apl-link" onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
      </form>
    );
  }
  return (
    <>
      <div className="show-adm-rowacts">
        <label className="show-adm-tier">
          <span className="show-sr">Who can watch {label}</span>
          <select value={tier} disabled={!can.approve || busy} onChange={(e) => setTier(e.target.value)}>
            <option value="free">Free</option>
            <option value="premium">Tapa +</option>
          </select>
        </label>
        <button type="button" className="apl-btn show-mini show-adm-approve" disabled={!can.approve || Boolean(blocked) || busy} title={blocked ? blocked.line : undefined} onClick={() => actions.approveRow(row, tier)}>
          <CheckIcon size={14} /> {busy ? 'Working…' : 'Approve'}
        </button>
        <button type="button" className="apl-btn-secondary show-mini" disabled={!can.approve || busy} onClick={() => setRejecting(true)}>Reject…</button>
        {placeBlock && free && can.edit ? (
          <button type="button" className="apl-btn-secondary show-mini" disabled={busy} onClick={() => actions.useNumber(row, free)}>Use E{free}</button>
        ) : null}
      </div>
      {!can.approve && needs.approve ? <p className="show-adm-need"><LockIcon size={11} /> <span>{needs.approve}</span></p> : null}
    </>
  );
}

// Admin → Shows: a row whose removal its uploader asked for.
function AdminRemovalActions({ row, ctx, actions, busy }) {
  const can = ctx.admin.can || {};
  const needs = ctx.admin.needs || {};
  return (
    <>
      <div className="show-adm-rowacts">
        <span className="show-adm-rowk">Removal requested</span>
        <button type="button" className="show-danger-btn show-mini" disabled={!can.deletions || busy} onClick={() => actions.decideRemoval(row, 'confirm')}>Confirm removal</button>
        <button type="button" className="apl-btn-secondary show-mini" disabled={!can.deletions || busy} onClick={() => actions.decideRemoval(row, 'deny')}>Keep it</button>
      </div>
      {!can.deletions && needs.deletions ? <p className="show-adm-need"><LockIcon size={11} /> <span>{needs.deletions}</span></p> : null}
    </>
  );
}

function GapRow({ row, ctx, actions }) {
  return (
    <li className="show-row gap" id={`gap-${row.season}-${row.from}`} data-gap="true">
      <span className="show-row-order-space" aria-hidden="true" />
      <span className="show-ebadge is-gap" aria-hidden="true">E{row.from}</span>
      <p className="show-gap-words">
        {row.words}
        {ctx.canAdd && (
          <>
            {' — '}
            <a href={ctx.submitHref({ season: row.season, number: row.from })} className="apl-link">add here</a>
            {ctx.canReorder && (
              <>
                {' or '}
                <button type="button" className="apl-link" disabled={!ctx.reorderOpen} title={ctx.reorderOpen ? undefined : ctx.reorderLine} onClick={() => actions.askRenumber(row.season)}>renumber</button>
              </>
            )}
          </>
        )}
      </p>
    </li>
  );
}

export default function SeasonSection({ season, ctx, actions, children = null }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const labelName = season.label && season.label.includes(' · ') ? season.label.slice(season.label.indexOf(' · ') + 3) : '';
  const rows = season.rows || [];
  const items = rows.filter((r) => r.kind !== 'gap');
  const order = items.filter((r) => r.inRunningOrder !== false && r.status !== 'rejected' && !r.withdrawnAt);
  const episodes = items.filter((r) => r.kind === 'episode');
  const inReview = episodes.filter((r) => r.status === 'pending').length;
  const drafts = items.filter((r) => r.kind === 'draft');
  const ready = drafts.filter((r) => r.mine && r.ready);
  const counts = [];
  if (episodes.length || !drafts.length) counts.push(`${episodes.length} episode${episodes.length === 1 ? '' : 's'}`);
  if (inReview) counts.push(`${inReview} in review`);
  if (drafts.length) counts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  if (ready.length) counts.push(`${ready.length} ready to send`);
  const sending = ctx.sending && ctx.sending.season === season.number ? ctx.sending : null;
  const menu = [];
  if (ctx.canRun) {
    menu.push({ key: 'rename', label: labelName ? 'Rename season' : 'Name this season', icon: <PencilIcon size={15} />, disabled: !ctx.shows118, note: ctx.shows118 ? null : 'needs migration 118', onClick: () => { setName(labelName); setRenaming(true); } });
    menu.push({ key: 'renumber', label: 'Renumber from 1…', icon: <span className="show-menu-cc" aria-hidden="true">1→</span>, disabled: !ctx.reorderOpen, note: ctx.reorderOpen ? null : 'needs migration 118', onClick: () => actions.askRenumber(season.number) });
    if (season.number === ctx.lastSeason) menu.push({ key: 'next', label: `Start Season ${season.number + 1}`, icon: <span className="show-menu-cc" aria-hidden="true">+</span>, onClick: () => actions.addSeason() });
  }
  return (
    <section className={`show-season ${ctx.dropSeason === season.number ? 'has-drop' : ''}`} aria-labelledby={`show-season-${season.number}`} data-season-section={season.number}>
      <header className="show-season-head" data-season={season.number} data-droppable={ctx.canReorder && ctx.reorderOpen ? 'true' : undefined}>
        <div className="show-season-title">
          <h2 id={`show-season-${season.number}`}>
            <span className="show-season-n">Season {season.number}</span>
            {labelName ? <span className="show-season-label"> · {labelName}</span> : null}
          </h2>
          <span className="show-season-count">{season.empty ? `Kept once its first episode lands` : counts.join(' · ')}</span>
        </div>
        {ready.length > 0 && (
          <button type="button" className="apl-btn show-send" disabled={Boolean(ctx.sending) || !ctx.drafts116} onClick={() => actions.send(season.number, ready.map((r) => r.id))}>
            <SendIcon size={15} /> {sending ? sending.label : `Send ${ready.length} for review`}
          </button>
        )}
        <RowMenu items={menu} label={`More for Season ${season.number}`} />
      </header>
      {renaming && (
        <form className="show-season-rename" onSubmit={(e) => { e.preventDefault(); setRenaming(false); actions.renameSeason(season.number, name); }}>
          <label htmlFor={`show-rename-${season.number}`} className="show-sr">Season {season.number}&rsquo;s name</label>
          <span className="show-season-rename-k" aria-hidden="true">Season {season.number} ·</span>
          <input id={`show-rename-${season.number}`} type="text" maxLength={80} value={name} placeholder="Optional name" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }} />
          <button type="submit" className="apl-btn-secondary show-mini">Save</button>
          <button type="button" className="apl-link" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      )}
      {ctx.confirm && ctx.confirm.season === season.number && (
        <div className="show-confirm" role="alertdialog" aria-label={`Renumber Season ${season.number} from 1`}>
          <p><strong>Renumber Season {season.number} from E1?</strong> {ctx.confirm.words}</p>
          <p className="show-confirm-sub">Every other place keeps its number otherwise; this fills the gaps. Visitors see the new numbers within a few minutes.</p>
          <div className="show-confirm-acts">
            <button type="button" className="apl-btn show-mini-btn" disabled={ctx.busyRow === `renumber-${season.number}`} onClick={() => actions.renumber(season.number)}>{ctx.busyRow === `renumber-${season.number}` ? 'Renumbering…' : 'Renumber'}</button>
            <button type="button" className="apl-link" onClick={() => actions.cancelConfirm()}>Cancel</button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <ol className="show-rows">
          {rows.map((r) => (r.kind === 'gap'
            ? <GapRow key={r.id} row={r} ctx={ctx} actions={actions} />
            : <EpisodeRow key={`${r.kind}-${r.id}`} row={r} index={order.indexOf(r)} count={order.length} ctx={ctx} actions={actions} />))}
        </ol>
      )}
      {children}
    </section>
  );
}
