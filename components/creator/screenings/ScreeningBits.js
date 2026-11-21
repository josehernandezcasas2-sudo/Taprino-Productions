import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepScrollInside } from '../../../lib/menuScroll';
import { SCREENING_WORDS, SCREENING_WORDS_WEB, validateLink } from '../../../lib/screeningRules';

// The pieces the website's private-screening pages share (migration 128,
// 2026-11-21; mockups/private-screenings-contract.md): the Private
// screenings tab (ScreeningsTab.js), the New link box (NewLinkDialog.js)
// and a link's own page (pages/creator/screenings/[id].js). Every word
// comes from lib/screeningRules.js; these only place it.

const fillIn = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

// A word from SCREENING_WORDS_WEB with its {x} filled in.
export function webText(key, vars) {
  return fillIn(SCREENING_WORDS_WEB[key] || '', vars);
}

// The answer a route gives, as a state the pages draw:
//   'loading' | 'ok' | 'update' (503 migration-128) | 'notYours' (403) |
//   'missing' (404) | 'signedOut' (401) | 'failed'.
function stateOf(status, data) {
  if (status === 503 && data && data.code === 'migration-128') return 'update';
  if (status === 403) return 'notYours';
  if (status === 404) return 'missing';
  if (status === 401) return 'signedOut';
  return 'failed';
}

// One screening route's answer. A re-read (after a change, or the link
// page's 30-second refresh) keeps what is on screen until the new answer
// is in, and a re-read that fails keeps the last good answer.
export function useScreeningRoute(url) {
  const [box, setBox] = useState({ url, data: null, state: url ? 'loading' : 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) {
      setBox({ url, data: null, state: 'idle' });
      return undefined;
    }
    let on = true;
    setBox((b) => (b.url === url ? b : { url, data: null, state: 'loading' }));
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!on) return;
        if (res.ok && data) {
          setBox({ url, data, state: 'ok' });
          return;
        }
        const state = stateOf(res.status, data);
        setBox((b) => (b.url === url && b.data && state === 'failed' ? b : { url, data: null, state }));
      })
      .catch(() => {
        if (on) setBox((b) => (b.url === url && b.data ? b : { url, data: null, state: 'failed' }));
      });
    return () => { on = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const same = box.url === url;
  return { data: same ? box.data : null, state: same ? box.state : (url ? 'loading' : 'idle'), reload };
}

// A write to a screening route. Never throws: { ok, status, data }, where a
// lost connection is status 0.
export async function callScreenings(url, { method = 'POST', body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

// What to say when a write didn't work.
export function errorLine(r) {
  if (!r || r.status === 0) return webText('offline');
  if (r.data && r.data.code === 'migration-128') return SCREENING_WORDS.needsUpdate;
  if (r.status === 403) return (r.data && r.data.error) || SCREENING_WORDS.notYours;
  return (r.data && r.data.error) || webText('couldNot');
}

// A fresh suggested password from the server (null when it can't answer).
export async function freshPassword() {
  const r = await callScreenings('/api/screenings/password', { method: 'GET' });
  return r.ok && r.data && typeof r.data.password === 'string' ? r.data.password : null;
}

// What the rules say about a password typed by hand (null = fine). The
// check is validateLink's own, so the sentence is the server's.
export function passwordProblem(password) {
  const r = validateLink({ label: 'ok', endsAt: new Date(Date.now() + 86400000).toISOString(), password });
  return !r.ok && r.field === 'password' ? r.error : null;
}

// The same for one typed email of a named person.
export function emailProblem(email) {
  const r = validateLink({ label: 'ok', endsAt: new Date(Date.now() + 86400000).toISOString(), password: 'probe-probe-1', access: 'named', named: { emails: [email] } });
  return !r.ok && r.field === 'named' ? r.error : null;
}

// The clipboard, with the old way as a fallback and, failing both, the
// browser's own box with the text selected.
export async function copyText(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // fall through to the old way
  }
  try {
    const el = document.createElement('textarea');
    el.value = s;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (ok) return true;
  } catch {
    // fall through to the prompt
  }
  try {
    window.prompt(webText('copyFailed'), s);
  } catch {
    // nothing else to try
  }
  return false;
}

// A button that copies and says "Copied" for a moment.
export function CopyButton({ text, label, ariaLabel, className = 'scn-btn sm' }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function go() {
    const ok = await copyText(text);
    if (!ok) return;
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  }
  return (
    <>
      <button type="button" className={`${className}${done ? ' copied' : ''}`} onClick={go} disabled={!text} aria-label={ariaLabel || undefined}>
        {done ? SCREENING_WORDS.copied : label}
      </button>
      <span className="visually-hidden" role="status">{done ? `${ariaLabel || label}: ${SCREENING_WORDS.copied}` : ''}</span>
    </>
  );
}

// A link's state as a pill: { label, tone } from linkState.
export function StatePill({ state }) {
  if (!state) return null;
  const mark = state.key === 'live' ? '●' : state.key === 'scheduled' ? '◷' : null;
  return (
    <span className={`scn-pill tone-${state.tone}`}>
      {mark && <span aria-hidden="true">{mark}</span>}
      {state.label}
    </span>
  );
}

// "7 of 25 opens" with the number in bold (a part from linkCard).
export function PartText({ part }) {
  if (part.strong && part.text.startsWith(part.strong)) return <><b>{part.strong}</b>{part.text.slice(part.strong.length)}</>;
  return part.text;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el) {
  return el.getClientRects().length > 0;
}

// Tab stays inside the box.
function trapTab(e, panel) {
  if (e.key !== 'Tab' || !panel) return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter(visible);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === panel || !panel.contains(at))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !panel.contains(at))) {
    e.preventDefault();
    first.focus();
  }
}

// The box every screening dialog sits in: drawn into <body>, a full-width
// sheet from the bottom under 900px and a centred box from 900px. Focus
// goes to the element marked data-autofocus (the heading), stays inside
// (Tab wraps), and returns to where it was when the box closes. Escape
// closes it; a click on the dim page around it closes it only when
// `closeOnBackdrop` (the confirm boxes; a half-filled form never). The
// page behind never scrolls (lib/menuScroll.js keepScrollInside, with
// overscroll-behavior: contain on the box's own scroll area).
export function Sheet({ labelledBy, onClose, children, className = '', closeOnBackdrop = false }) {
  const backRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return undefined;
    const before = document.activeElement;
    const panel = panelRef.current;
    const first = panel ? panel.querySelector('[data-autofocus]') || panel.querySelector(FOCUSABLE) : null;
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
    else if (panel) panel.focus({ preventScroll: true });
    const off = keepScrollInside(backRef.current);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      off();
      document.removeEventListener('keydown', onKey);
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div
      ref={backRef}
      className="scn-back"
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) closeRef.current(); }}
    >
      <div
        ref={panelRef}
        className={`scn-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, panelRef.current)}
      >
        <span className="scn-grab" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body
  );
}

// The round close button in a box's heading.
export function CloseButton({ onClick, disabled = false }) {
  return (
    <button type="button" className="scn-x" onClick={onClick} disabled={disabled} aria-label={webText('close')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

// A yes / no box (Discard…, End it now…). `onYes` answers null when it
// worked (the caller closes the box) or the sentence to show.
export function ConfirmSheet({ id, kicker, title, line, yes, no, onYes, onClose, children = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function go() {
    setBusy(true);
    setError(null);
    const problem = await onYes();
    if (!alive.current) return;
    if (problem) {
      setError(problem);
      setBusy(false);
    }
  }
  const close = () => { if (!busy) onClose(); };
  return (
    <Sheet labelledBy={`${id}-h`} onClose={close} className="small" closeOnBackdrop>
      <div className="scn-sheet-head">
        <div className="scn-sheet-head-text">
          {kicker && <span className="scn-k danger">{kicker}</span>}
          <h2 id={`${id}-h`} className="scn-sheet-title" tabIndex={-1} data-autofocus>{title}</h2>
        </div>
        <CloseButton onClick={close} disabled={busy} />
      </div>
      <div className="scn-sheet-body">
        <div className="scn-confirm">
          <p className="scn-hint">{line}</p>
          {children}
          {error && <p className="scn-error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="scn-sheet-foot">
        <button type="button" className="scn-btn" onClick={close} disabled={busy}>{no}</button>
        <button type="button" className="scn-btn danger-solid" onClick={go} disabled={busy} aria-busy={busy || undefined}>{yes}</button>
      </div>
    </Sheet>
  );
}

// The loading, "needs a database update", "not yours", "not there" and
// "couldn't load" cards.
export function RouteNote({ state, onRetry }) {
  if (state === 'loading' || state === 'idle') {
    return <div className="scn-skel" aria-busy="true" aria-label={webText('loading')}><span /><span /><span /></div>;
  }
  const text = state === 'update' ? SCREENING_WORDS.needsUpdate
    : state === 'notYours' ? SCREENING_WORDS.notYours
      : state === 'missing' ? webText('linkMissing')
        : webText('failed');
  return (
    <div className="scn-note-card" role={state === 'failed' ? 'alert' : undefined}>
      <p>{text}</p>
      {state === 'failed' && onRetry && <button type="button" className="scn-btn sm" onClick={onRetry}>{webText('tryAgain')}</button>}
    </div>
  );
}
