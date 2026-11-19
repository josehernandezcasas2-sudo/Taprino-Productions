import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/router';
import PlaceSearch from '../crew/PlaceSearch';
import { keepScrollInside } from '../../lib/menuScroll';
import { START_MAX_LOGLINE, START_MAX_TITLE, START_WORDS, startSheet } from '../../lib/productionDashRules';

// Start the production from a pitch (2026-11-19; the StartSheet board on
// https://claude.ai/artifact/Kx7ZjgzAsG4xBxYBws2QKN): filled in from the
// pitch, a bottom sheet under 900px and a dialog from 900px. What it says
// is lib/productionDashRules.js startSheet; it posts to
// /api/pitches/<id>/production and goes to the new dashboard.
//
// pitch: { id, title, logline, tag }; backers: how many backed it.
export default function StartSheet({ pitch, backers = 0, onClose }) {
  const router = useRouter();
  const sheet = startSheet(pitch, backers);
  const [form, setForm] = useState(sheet.defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [existing, setExisting] = useState(null);
  const backRef = useRef(null);
  const bodyRef = useRef(null);
  const firstRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Focus in, Escape out, focus back to where it was, the page still.
  useEffect(() => {
    const before = typeof document !== 'undefined' ? document.activeElement : null;
    if (firstRef.current) firstRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const releaseBody = keepScrollInside(bodyRef.current);
    const releaseBack = keepScrollInside(backRef.current);
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseBody();
      releaseBack();
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const res = await fetch(`/api/pitches/${encodeURIComponent(pitch.id)}/production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, kind: form.kind || null, startsOn: form.startsOn || null, endsOn: form.endsOn || form.startsOn || null })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === 'exists') {
        setExisting(data.dashboardHref || null);
        setError(data.error || START_WORDS.exists);
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not start the production.');
      router.push(`${data.dashboardHref}${data.dashboardHref.includes('?') ? '&' : '?'}started=1&told=${encodeURIComponent(data.toldState || 'off')}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const node = (
    <div className="pst-root">
      <div ref={backRef} className="pst-back" onClick={onClose} aria-hidden="true" />
      <form className="pst-sheet" role="dialog" aria-modal="true" aria-labelledby="pst-title" onSubmit={submit}>
        <span className="pst-grab" aria-hidden="true" />
        <div className="pst-head">
          <span className="pst-kicker">{sheet.kicker}</span>
          <h2 id="pst-title" className="pst-title">{sheet.title}</h2>
          <span className="pst-sub">{sheet.sub}</span>
          <button type="button" className="pst-close" aria-label={START_WORDS.close} onClick={onClose}>×</button>
        </div>
        <div ref={bodyRef} className="pst-body">
          <label className="pst-field"><span>{sheet.labels.title}</span>
            <input ref={firstRef} type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={START_MAX_TITLE} required />
          </label>
          <label className="pst-field"><span>{sheet.labels.logline}</span>
            <textarea rows={2} value={form.logline} onChange={(e) => set({ logline: e.target.value })} maxLength={START_MAX_LOGLINE} />
          </label>
          <label className="pst-field"><span>{sheet.labels.kind}</span>
            <select value={form.kind || ''} onChange={(e) => set({ kind: e.target.value || null })} required>
              {!form.kind && <option value="">{START_WORDS.pickKind}</option>}
              {sheet.kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <div className="pst-row2">
            <label className="pst-field"><span>{sheet.labels.startsOn}</span>
              <input type="date" value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
            </label>
            <label className="pst-field"><span>{sheet.labels.endsOn}</span>
              <input type="date" value={form.endsOn} min={form.startsOn || undefined} onChange={(e) => set({ endsOn: e.target.value })} />
            </label>
          </div>
          <div className="pst-field"><span>{sheet.labels.place}</span>
            <PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder={START_WORDS.placePlaceholder} compact allowLocate={false} />
          </div>
          <div className="pst-switches">
            <div className="pst-switch-row">
              <span className="pst-switch-text"><b>{sheet.keep.title}</b><span>{sheet.keep.line}</span></span>
              <span className="pst-check" aria-hidden="true">✓</span>
            </div>
            <label className="pst-switch-row">
              <span className="pst-switch-text"><b>{sheet.tell.title}</b><span>{sheet.tell.line}</span></span>
              <input type="checkbox" className="pst-toggle" role="switch" checked={Boolean(form.tellBackers)} onChange={(e) => set({ tellBackers: e.target.checked })} aria-label={sheet.tell.title} />
            </label>
          </div>
          <p className="pst-note">{sheet.visibility}</p>
          {error && (
            <div className="pst-error" role="alert">
              {error}
              {existing && <> <Link href={existing}>{START_WORDS.open} ›</Link></>}
            </div>
          )}
        </div>
        <div className="pst-foot">
          <button type="submit" className="pst-submit" disabled={busy || form.title.trim().length < 2 || !form.kind}>{busy ? sheet.busy : sheet.submit}</button>
        </div>
      </form>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}
