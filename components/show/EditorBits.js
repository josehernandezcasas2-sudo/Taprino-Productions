import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BackArrowIcon, ClockIcon, CloseIcon, LockIcon } from '../PlayerIcons';
import { pickerKeys } from './roomBits';
import { PICTURES_TOO_LARGE } from '../../lib/shrinkImage';

// The pieces the series revamp's editors share (slice 2, mockups/
// series-slice2-components.md): the episode editor, the draft editor and
// Edit show. EditorFrame draws either layout — `page` (a phone-first
// screen: the Back pill, the head, tabs, one tab at a time, a footer that
// sticks to the bottom of the screen) or `panel` (the control room's
// 420px right-hand panel on a laptop: a close button, the tabs' contents
// stacked as sections with headings, the footer pinned to the panel's
// bottom). Everything here is presentational; the editors own the state.

// fetch, answering { ok, status, data, error } and never throwing: `error`
// is the route's own line (the /api/show routes always answer one).
export async function callApi(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const out = data && typeof data === 'object' ? data : {};
    // A body over the host's limit (Vercel's 4.5 MB) is refused before the
    // route runs, with a page of its own: only pictures get that big.
    if (res.status === 413) return { ok: false, status: 413, data: out, error: PICTURES_TOO_LARGE };
    return { ok: res.ok, status: res.status, data: out, error: res.ok ? null : out.error || `Something went wrong (${res.status}). Try again.` };
  } catch {
    return { ok: false, status: 0, data: {}, error: 'Couldn’t reach the site — check the connection and try again.' };
  }
}

export function readAsDataUrl(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// "Oct 12", in the studio's time zone like every other date on the site.
export function shortDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch {
    return null;
  }
}

export function uploadRunning(activeUpload) {
  return Boolean(activeUpload && ['requesting-url', 'uploading'].includes(activeUpload.status));
}

export function uploadPct(upload) {
  if (!upload || !upload.fileSize) return 0;
  return Math.min(100, Math.round((upload.bytesUploaded / upload.fileSize) * 100));
}

// What the file card says about the master. An approved title isn't asked
// again ('unknown' there means playing).
export function masterWords(state) {
  switch (state) {
    case 'ready': return { tone: 'ok', text: 'Ready' };
    case 'unknown': return { tone: 'ok', text: 'Playing' };
    case 'processing': return { tone: 'review', text: 'Processing on our side' };
    case 'uploading': return { tone: 'warn', text: 'The upload never finished' };
    case 'error': return { tone: 'danger', text: 'The file failed — replace it' };
    case 'deleted': return { tone: 'danger', text: 'The file is gone — add it again' };
    case 'audio': return { tone: 'ok', text: 'Audio episode' };
    case 'external': return { tone: 'ok', text: 'Ready', note: 'its own address' };
    default: return { tone: 'neutral', text: 'No file yet' };
  }
}

// The words for a field whose save does more than save: "Ask us to…",
// "Waits for approval…". Null for a field that simply applies.
export function lineFor(policy) {
  if (!policy || policy.mode === 'direct') return null;
  return policy.line || null;
}

export function isOpen(policy) {
  return Boolean(policy) && (policy.mode === 'direct' || policy.mode === 'staged');
}

// A field's label row: the clock glyph on a field that waits for approval,
// the lock on one that is the team's, the count on the right.
export function FieldHead({ htmlFor, id, label, hint, staged = false, locked = false, count = null, max = null }) {
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <div className="show-ed-label-row">
      <Tag className="show-ed-label" id={id} {...(htmlFor ? { htmlFor } : {})}>
        {staged && <ClockIcon size={12} />}
        {locked && <LockIcon size={11} />}
        <span>{label}</span>
        {hint && <em>{hint}</em>}
      </Tag>
      {max ? <span className={`show-ed-count ${count > max ? 'over' : ''}`}>{count.toLocaleString('en-US')} / {max.toLocaleString('en-US')}</span> : null}
    </div>
  );
}

// Under a field: the policy's line when it doesn't simply save, or the
// "edited, not saved yet" note.
export function FieldNote({ policy, edited = false }) {
  if (policy && (policy.mode === 'locked' || policy.mode === 'invite')) {
    return <p className="show-ed-line locked"><LockIcon size={11} /> {policy.line || 'This can’t be changed here'}</p>;
  }
  if (edited) {
    return <p className="show-ed-edited"><i aria-hidden="true" /> Edited, not saved yet · {policy && policy.mode === 'staged' ? 'goes to review when you save' : 'applies at once when you save'}</p>;
  }
  return null;
}

export function Switch({ id, on, onChange, disabled = false, label, labelledBy }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`seal-switch show-ed-switch ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

// A switch with its words: the line it changes and what that means.
export function SwitchRow({ id, title, children, on, onChange, disabled = false, policy = null }) {
  const labelId = `${id}-label`;
  return (
    <div className="show-ed-switch-row">
      <div className="show-ed-switch-text">
        <span className="show-ed-switch-title" id={labelId}>{title}</span>
        {children ? <span className="show-ed-switch-sub">{children}</span> : null}
        <FieldNote policy={policy} />
      </div>
      <Switch id={id} on={on} onChange={onChange} disabled={disabled} labelledBy={labelId} />
    </div>
  );
}

// A change waiting for an admin: what it is, and Cancel.
export function StagedBox({ title, value = null, children = null, onCancel = null, busy = false, cancelLabel = 'Cancel' }) {
  return (
    <div className="show-ed-staged">
      <div className="show-ed-staged-text">
        <span className="show-ed-staged-k">{title}</span>
        {value ? <strong>{value}</strong> : null}
        {children}
      </div>
      {onCancel && <button type="button" className="show-ed-cancel" onClick={onCancel} disabled={busy}>{busy ? '…' : cancelLabel}</button>}
    </div>
  );
}

export function Banner({ level = 'review', icon = null, title, children = null, action = null }) {
  return (
    <div className={`show-ed-banner level-${level}`} role={level === 'danger' ? 'alert' : undefined}>
      {icon && <span className="show-ed-banner-icon" aria-hidden="true">{icon}</span>}
      <div className="show-ed-banner-text">
        <strong>{title}</strong>
        {children}
      </div>
      {action}
    </div>
  );
}

// An object URL for a picked file, released when it changes.
export function useObjectUrl(file) {
  const url = useMemo(() => (file && typeof URL !== 'undefined' ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

// One picture slot (poster 2:3, still 16:9, hero 21:9, title image): what
// is live, what was picked and waits for Save, what waits for approval
// (the live one and the proposed one side by side, with Cancel), or the
// show's art standing in. The buttons come from the caller (`actions`).
export function ArtSlot({ kind = 'still', label, status = null, policy = null, live = null, fallback = null, fallbackTag = null, picked = null, pickedNote = null, staged = null, stagedNote = null, onCancelStaged = null, cancelBusy = false, emptyTitle = 'None', emptyText = null, caption = null, actions = null, removing = false }) {
  const pickedUrl = useObjectUrl(picked);
  const stagedPolicy = policy && policy.mode === 'staged';
  const shown = removing ? null : pickedUrl || live || null;
  const pill = status === 'live' ? { cls: 'ok', text: 'Live' } : status === 'waiting' ? { cls: 'review', text: 'Waiting for approval' } : status === 'new' ? { cls: 'review', text: stagedPolicy ? 'Goes to review' : 'Not saved yet' } : status === 'none' ? { cls: 'neutral', text: 'None' } : null;
  return (
    <div className={`show-ed-art-slot kind-${kind}`}>
      <div className="show-ed-art-head">
        <span className="show-ed-label">
          {stagedPolicy && <ClockIcon size={12} />}
          {policy && policy.mode === 'locked' && <LockIcon size={11} />}
          <span>{label}</span>
        </span>
        {pill && <span className={`show-ed-pill tone-${pill.cls}`}>{pill.text}</span>}
      </div>
      {staged ? (
        <div className="show-ed-art-waiting">
          <div className="show-ed-art-pair">
            <figure>
              <div className={`show-ed-art-img kind-${kind}`}>{live ? <img src={live} alt="" /> : <span>None</span>}</div>
              <figcaption className="tone-ok">Live now</figcaption>
            </figure>
            <span className="show-ed-art-arrow" aria-hidden="true">→</span>
            <figure>
              <div className={`show-ed-art-img kind-${kind}`}><img src={staged} alt="" /></div>
              <figcaption className="tone-review">Proposed</figcaption>
            </figure>
          </div>
          <div className="show-ed-art-waiting-row">
            <p>{stagedNote || 'Visitors see the live one until we approve this one.'}</p>
            {onCancelStaged && <button type="button" className="show-ed-cancel" onClick={onCancelStaged} disabled={cancelBusy}>{cancelBusy ? '…' : 'Cancel'}</button>}
          </div>
          {actions && <div className="show-ed-art-acts">{actions}</div>}
        </div>
      ) : (
        <div className="show-ed-art-body">
          <div className={`show-ed-art-img kind-${kind} ${shown ? '' : fallback ? 'is-fallback' : 'is-empty'}`}>
            {shown ? <img src={shown} alt="" /> : fallback ? <img src={fallback} alt="" /> : (
              <span className="show-ed-art-empty"><strong>{emptyTitle}</strong>{emptyText ? <span>{emptyText}</span> : null}</span>
            )}
            {!shown && fallback && fallbackTag ? <span className="show-ed-art-tag">{fallbackTag}</span> : null}
          </div>
          <div className="show-ed-art-side">
            {caption ? <p className="show-ed-art-caption">{caption}</p> : null}
            {pickedNote ? <p className="show-ed-art-caption tone-review">{pickedNote}</p> : null}
            {actions && <div className="show-ed-art-acts">{actions}</div>}
          </div>
        </div>
      )}
      <FieldNote policy={policy} />
    </div>
  );
}

// A file input dressed as a small pill button.
export function PickButton({ label, accept, onPick, disabled = false, className = 'show-ed-mini' }) {
  return (
    <label className={`${className} ${disabled ? 'is-off' : ''}`} role="button" aria-disabled={disabled ? 'true' : undefined} {...pickerKeys(disabled)}>
      {label}
      <input type="file" accept={accept} hidden disabled={disabled} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onPick(f); }} />
    </label>
  );
}

// The sticky header's height, so the tabs stick under it and the panel
// starts below it. Written onto the editor's own root as --show-ed-top.
export function useHeaderOffset(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return undefined;
    const header = document.querySelector('header.channel-bar') || document.querySelector('.channel-bar');
    const set = () => {
      const h = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
      el.style.setProperty('--show-ed-top', `${h}px`);
    };
    set();
    window.addEventListener('resize', set);
    window.addEventListener('scroll', set, { passive: true });
    return () => {
      window.removeEventListener('resize', set);
      window.removeEventListener('scroll', set);
    };
  }, [ref]);
}

// Closing the tab with unsaved changes asks first. (In-app navigation
// asks through the editors' own Back and × buttons: the control room
// changes the route shallowly and must not be stopped.)
export function useBeforeUnload(dirty) {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;
    const ask = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);
}

// Tells the host (the control room) whether there are unsaved changes, so
// it can ask before it switches rows or closes the panel; false again when
// the editor goes.
export function useDirtyReport(dirty, onDirtyChange) {
  const cb = useRef(onDirtyChange);
  cb.current = onDirtyChange;
  useEffect(() => {
    if (cb.current) cb.current(Boolean(dirty));
  }, [dirty]);
  useEffect(() => () => {
    if (cb.current) cb.current(false);
  }, []);
}

// A short line that fades: "Saved", what waits, what didn't save.
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (next, ms = 6000) => {
    clearTimeout(timer.current);
    setToast(next);
    if (next && ms) timer.current = setTimeout(() => setToast(null), ms);
  };
  return [toast, show];
}

export function Toast({ toast, onClose }) {
  if (!toast) return <div className="show-ed-toast-slot" aria-live="polite" />;
  return (
    <div className="show-ed-toast-slot" aria-live="polite">
      <div className={`show-ed-toast tone-${toast.tone || 'ok'}`}>
        <div className="show-ed-toast-text">
          <strong>{toast.title}</strong>
          {(toast.lines || []).map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <button type="button" className="show-ed-toast-x" aria-label="Dismiss" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
    </div>
  );
}

// The frame both layouts share. `sections` = [{ key, label, content }];
// on a page one shows at a time under the tabs, in the panel they stack.
export function EditorFrame({
  layout = 'page', rootRef, backHref = null, backLabel = 'Back', onBack = null, onClose = null,
  eyebrow = null, pill = null, title, titleNote = null, banners = null, sections = [], active, onTab,
  footer = null, toast = null, ariaLabel = 'Editor', tabsLabel = 'Sections'
}) {
  const panel = layout === 'panel';
  const Tag = panel ? 'aside' : 'div';
  // The panel takes the focus when it opens (a keyboard user lands in it,
  // not back in the room's rows) and gives it back to what opened it — the
  // row, Edit show — when it closes, unless the focus has moved on.
  const [opener] = useState(() => (panel && typeof document !== 'undefined' ? document.activeElement : null));
  useEffect(() => {
    if (!panel) return undefined;
    const el = rootRef ? rootRef.current : null;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || Boolean(el && el.contains(now));
      if (lost && opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
  const head = (
    <div className="show-ed-head">
      <div className="show-ed-head-main">
        <div className="show-ed-eyebrow-row">
          {eyebrow && <span className="show-ed-eyebrow">{eyebrow}</span>}
          {pill && <span className={`show-ed-pill tone-${pill.tone || 'neutral'}`}>{pill.text}</span>}
          {pill && pill.since ? <span className="show-ed-since">{pill.since}</span> : null}
        </div>
        <h1 className="show-ed-h1">{title}</h1>
        {titleNote}
      </div>
      {panel && onClose && (
        <button type="button" className="show-ed-close" aria-label="Close the editor" onClick={onClose}><CloseIcon size={16} /></button>
      )}
    </div>
  );
  const shown = panel ? sections : sections.filter((s) => s.key === active);
  return (
    <Tag className={`show-ed ${panel ? 'is-panel' : 'is-page'}`} ref={rootRef} aria-label={ariaLabel} tabIndex={panel ? -1 : undefined}>
      {!panel && backHref && (
        <Link href={backHref} className="acct-back show-ed-back" onClick={(e) => { if (onBack && onBack(e) === false) e.preventDefault(); }}>
          <BackArrowIcon size={14} /> <span className="show-ed-back-text">{backLabel}</span>
        </Link>
      )}
      {panel ? (
        <>
          {head}
          <div className="show-ed-scroll">
            {banners}
            {shown.map((s) => (
              <section key={s.key} className="show-ed-section" aria-labelledby={`show-ed-sec-${s.key}`}>
                <h2 className="show-ed-section-k" id={`show-ed-sec-${s.key}`}>{s.label}</h2>
                {s.content}
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          {head}
          {banners}
          {sections.length > 1 && (
            <div
              className="show-tabs"
              role="tablist"
              aria-label={tabsLabel}
              onKeyDown={(e) => {
                // The tabs pattern: ← → (and Home / End) move between tabs;
                // Tab goes on to the open one's contents.
                const i = sections.findIndex((s) => s.key === active);
                const n = sections.length;
                const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
                if (j === null || i < 0) return;
                e.preventDefault();
                onTab(sections[j].key);
                const btn = document.getElementById(`show-ed-tab-${sections[j].key}`);
                if (btn) btn.focus();
              }}
            >
              {sections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  id={`show-ed-tab-${s.key}`}
                  aria-selected={s.key === active ? 'true' : 'false'}
                  aria-controls={`show-ed-panel-${s.key}`}
                  tabIndex={s.key === active ? 0 : -1}
                  className={`show-tab ${s.key === active ? 'on' : ''}`}
                  onClick={() => onTab(s.key)}
                >
                  {s.label}{s.glyph ? <span className="show-tab-glyph" role={s.glyphLabel ? 'img' : undefined} aria-label={s.glyphLabel || undefined}>{s.glyph}</span> : null}
                </button>
              ))}
            </div>
          )}
          {shown.map((s) => (
            <section key={s.key} className="show-ed-section" role={sections.length > 1 ? 'tabpanel' : undefined} id={`show-ed-panel-${s.key}`} aria-labelledby={sections.length > 1 ? `show-ed-tab-${s.key}` : undefined}>
              {s.content}
            </section>
          ))}
        </>
      )}
      {toast}
      {footer && <div className="show-ed-foot">{footer}</div>}
    </Tag>
  );
}
