import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { keepScrollInside } from '../../lib/menuScroll';
import { TYPE_WORDS, makeMain, orderedTypes, sheetRows, toggleType, typesRow } from '../../lib/accountTypeRules';
import { ACCOUNT_TYPES_EVENT, CloseIcon, announceAccountTypes, postAccountTypes } from './AccountTypeBits';

// Account → Profile's "Your types" card (Jose, 2026-11-18; the Switch board
// of the canvas https://claude.ai/artifact/GxAa8Qj57oQRuBF7c5xo4q; migration
// 126): the row (`typesRow`) with Change, which opens the Your types sheet
// — a bottom sheet under 900px, a dialog from 900px. The sheet saves on
// its own (never with the profile's Save) and tells the rest of the page
// and the ☰ menu (`tapa:account-types`). /account/profile#types opens it
// once the page has loaded (the ☰ menu's "+ Add a type"). Every word is
// lib/accountTypeRules.js.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default function AccountTypesCard({ initial, isCreator = false }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => initial || { types: [], main: null, asked: false, available: false });
  const [open, setOpen] = useState(false);
  const changeRef = useRef(null);
  const row = typesRow(saved);

  // Someone else on the page saved (the ☰ menu switching the main).
  useEffect(() => {
    const onSaved = (e) => {
      const d = e && e.detail;
      if (!d || !Array.isArray(d.types)) return;
      setSaved((s) => ({ ...s, types: orderedTypes(d.types, d.main), main: orderedTypes(d.types, d.main)[0] || null, asked: true, available: true }));
    };
    window.addEventListener(ACCOUNT_TYPES_EVENT, onSaved);
    return () => window.removeEventListener(ACCOUNT_TYPES_EVENT, onSaved);
  }, []);

  // #types opens the sheet: on arriving, and when a link on this page
  // (the ☰ menu's "+ Add a type") changes the hash to it.
  useEffect(() => {
    const check = (url) => {
      const hash = typeof url === 'string' ? (url.split('#')[1] || '') : (window.location.hash || '').slice(1);
      if (hash === 'types' && !row.disabled) setOpen(true);
    };
    check();
    router.events.on('hashChangeComplete', check);
    return () => router.events.off('hashChangeComplete', check);
  }, [router.events, row.disabled]);

  const close = useCallback(() => {
    setOpen(false);
    // Drop #types from the address so the menu's link opens it again.
    if (typeof window !== 'undefined' && window.location.hash === '#types') {
      try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`); } catch (err) { /* old browsers */ }
    }
    if (changeRef.current) changeRef.current.focus();
  }, []);

  return (
    <div id="types" className={`atp-rowcard${row.disabled ? ' disabled' : ''}`}>
      <div className="atp-rowcard-text">
        <span className="atp-rowcard-label">{row.label}</span>
        <span className="atp-rowcard-value">{row.value}</span>
        {row.note && <span className="atp-rowcard-note">{row.note}</span>}
      </div>
      <button
        ref={changeRef}
        type="button"
        className="atp-rowcard-change"
        disabled={row.disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {row.action}
      </button>
      {open && (
        <TypesSheet
          saved={saved}
          isCreator={isCreator}
          onClose={close}
          onSaved={(state) => { setSaved(state); announceAccountTypes(state); close(); }}
        />
      )}
    </div>
  );
}

function TypesSheet({ saved, isCreator, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({ types: orderedTypes(saved.types, saved.main), main: saved.main }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sheetRef = useRef(null);
  const bodyRef = useRef(null);
  const backRef = useRef(null);
  const titleRef = useRef(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const rows = sheetRows(draft, { isCreator });

  useEffect(() => {
    if (titleRef.current) titleRef.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const items = [...sheetRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const offBody = keepScrollInside(bodyRef.current);
    const offBack = keepScrollInside(backRef.current);
    return () => { document.removeEventListener('keydown', onKey); offBody(); offBack(); };
  }, [onClose]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await postAccountTypes({ types: orderedTypes(draft.types, draft.main), main: draft.main });
    setBusy(false);
    if (r.ok) {
      const s = r.state || {};
      onSaved({ types: orderedTypes(s.types, s.main), main: s.main || null, asked: true, watcher: !(s.types && s.types.length), available: true });
      return;
    }
    setError(r.status === 503 && r.code === 'migration-126' ? TYPE_WORDS.notReady : TYPE_WORDS.failed);
  }

  const node = (
    <div ref={backRef} className="atp-sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={sheetRef} className="atp-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="atp-grab" aria-hidden="true" />
        <div className="atp-sheet-head">
          <div className="atp-sheet-head-text">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="atp-sheet-title">{TYPE_WORDS.sheetTitle}</h2>
            <p className="atp-sheet-intro">{TYPE_WORDS.sheetIntro}</p>
          </div>
          <button type="button" className="atp-x" aria-label={TYPE_WORDS.close} onClick={onClose}><CloseIcon /></button>
        </div>
        <div ref={bodyRef} className="atp-sheet-body">
          <div className="atp-rows">
            {rows.map((r) => {
              const nameId = `${uid}-${r.type}`;
              return (
                <div key={r.type} className={`atp-row${r.checked ? ' on' : ''}`} data-type={r.type}>
                  <div className="atp-row-main">
                    <label className="atp-row-label">
                      <input type="checkbox" checked={r.checked} onChange={() => setDraft((d) => toggleType(d, r.type))} />
                      <span className="atp-row-text">
                        <span id={nameId} className="atp-row-name">{r.label}</span>
                        <span className="atp-row-line">{r.line}</span>
                      </span>
                    </label>
                    {r.main ? (
                      <span className="atp-main-pill big">{TYPE_WORDS.mainChip}</span>
                    ) : r.canMakeMain ? (
                      <button type="button" className="atp-makemain" aria-describedby={nameId} onClick={() => setDraft((d) => makeMain(d, r.type))}>{TYPE_WORDS.makeMain}</button>
                    ) : null}
                  </div>
                  {r.note && (
                    <p className="atp-row-note">{r.note.text} <Link href={r.note.href}>{r.note.link}</Link></p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="atp-sheet-note">
            <span className="atp-sheet-note-icon" aria-hidden="true"><ShieldIcon /></span>
            <span>{TYPE_WORDS.sheetNote}</span>
          </div>
        </div>
        <div className="atp-sheet-foot">
          {error && <p className="atp-error" role="alert">{error}</p>}
          <button type="button" className="atp-continue" onClick={save} disabled={busy}>{busy ? TYPE_WORDS.saving : TYPE_WORDS.save}</button>
        </div>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}
