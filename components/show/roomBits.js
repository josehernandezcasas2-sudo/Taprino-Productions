import { useEffect, useState } from 'react';

// Small pieces the show page (the control room, components/show/
// ShowControlRoom.js) shares between its parts: the room's own glyphs, the
// laptop test, the room's addresses, a few words.

// The room's addresses for a mode: the creator's /creator/show/<id>; the
// team's /admin/shows/<id> (slice 3).
export function roomPaths(mode, showId) {
  const base = mode === 'admin' ? `/admin/shows/${encodeURIComponent(showId)}` : `/creator/show/${encodeURIComponent(showId)}`;
  return {
    base,
    episode: (id, draft) => `${base}/episode/${encodeURIComponent(id)}${draft ? '?draft=1' : ''}`,
    edit: (tab) => `${base}/edit${tab === 'art' ? '?tab=art' : ''}`
  };
}

// The laptop layout (two columns, the editor as a right-hand panel) starts
// at 1024px. Null until the page is in the browser.
export const WIDE_QUERY = '(min-width: 1024px)';
export function isWideNow() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
}
export function useWide() {
  const [wide, setWide] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setWide(false);
      return undefined;
    }
    const mq = window.matchMedia(WIDE_QUERY);
    const set = () => setWide(mq.matches);
    set();
    if (mq.addEventListener) mq.addEventListener('change', set);
    else mq.addListener(set);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', set);
      else mq.removeListener(set);
    };
  }, []);
  return wide;
}

// "2h ago", "yesterday", "3 days ago" (Creator Studio's words).
export function ago(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// "24 min" from "24:02" / "1:02:03" / seconds.
export function minutesOf(runtime) {
  if (runtime === null || runtime === undefined || runtime === '') return null;
  let seconds = null;
  if (typeof runtime === 'number') seconds = runtime;
  else {
    const parts = String(runtime).split(':').map((x) => Number(x));
    if (parts.some((x) => !Number.isFinite(x))) return null;
    seconds = parts.reduce((acc, x) => acc * 60 + x, 0);
  }
  if (!(seconds > 0)) return null;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
}

export function bytesShort(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return null;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function bg(url) {
  return url ? { backgroundImage: `url("${String(url).replace(/"/g, '%22')}")` } : undefined;
}

// Tab and Shift+Tab go round inside an open sheet (it is aria-modal: the
// page behind it is under its backdrop).
export function trapTab(e, panel) {
  if (e.key !== 'Tab' || !panel) return;
  const items = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true');
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

// "Drop a new master here": a hidden file input takes no drop, and a file
// dropped on a page without a handler opens in the tab instead. These
// props take the first file dropped (or refuse it while `disabled`).
export function fileDrop(onFile, disabled = false) {
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  return {
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && !disabled) onFile(f);
    }
  };
}

// A <label> dressed as a button around a hidden file input isn't in the
// tab order on its own: these props put it there and open the picker on
// Enter or Space (out of the tab order while it's off). The caller gives
// it a role (button, or menuitem in a menu).
export function pickerKeys(disabled = false) {
  return {
    tabIndex: disabled ? -1 : 0,
    onKeyDown: (e) => {
      if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const el = e.currentTarget;
      const input = el.querySelector('input[type="file"]') || (el.htmlFor ? document.getElementById(el.htmlFor) : null);
      if (input && !input.disabled) input.click();
    }
  };
}

// The glyphs the site's icon set doesn't have (PlayerIcons): the row's
// kebab, the drag grip, Send for review (a paper plane), an upload arrow.
export function KebabIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

export function GripIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function SendIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3L10 14" />
      <path d="M21 3l-7 18-4-7-7-4z" />
    </svg>
  );
}

export function UploadIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

export function ChevronIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function NoEyeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.8 10.8 0 0 1 12 6c4.5 0 8.2 2.5 10 6a12.6 12.6 0 0 1-3.2 3.9" />
      <path d="M6.6 6.7A12.4 12.4 0 0 0 2 12c1.8 3.5 5.5 6 10 6a10.6 10.6 0 0 0 4.6-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function BanIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}
