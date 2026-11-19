// Account types (migration 126; the rules and every word in
// lib/accountTypeRules.js). What the website's pieces share: the icon each
// type wears on the sign-up question, the one way a save is sent, and the
// window event that tells the rest of the page (the ☰ menu's you card, the
// Account → Profile row) what was saved, the way `taprino:own-profile-
// updated` tells the header about a new photo.

export const ACCOUNT_TYPES_EVENT = 'tapa:account-types';

// Tell every listener on this page what is saved now: { types, main, asked }.
export function announceAccountTypes(state) {
  if (typeof window === 'undefined' || !state) return;
  const detail = { types: Array.isArray(state.types) ? state.types : [], main: state.main || null, asked: state.asked !== false };
  window.dispatchEvent(new CustomEvent(ACCOUNT_TYPES_EVENT, { detail }));
}

// POST /api/account/types with { types, main } or { skip: true }.
// → { ok: true, state } | { ok: false, status, code, error }.
export async function postAccountTypes(body) {
  try {
    const res = await fetch('/api/account/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, code: data && data.code ? data.code : null, error: data && data.error ? data.error : null };
    return { ok: true, state: data };
  } catch (err) {
    return { ok: false, status: 0, code: null, error: null };
  }
}

const TYPE_PATHS = {
  creator: <><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3z" /></>,
  crew: <><path d="M9 3h6l-1 6h-4z" /><path d="M12 9v12M8 21h8" /></>,
  cast: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  studio: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></>
};

// The tint behind each type's icon (the Main board): Creator orange, Crew
// gold, Cast mint, Studio the page's ink.
export const TYPE_TINTS = { creator: 'brass', crew: 'gold', cast: 'mint', studio: 'ink' };

export function TypeIcon({ type, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TYPE_PATHS[type] || TYPE_PATHS.studio}
    </svg>
  );
}

export function TickIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// A radiogroup of chips that moves with the arrow keys the way radio
// buttons do (the chosen one is the only Tab stop; an arrow chooses the
// next one). `items` = [{ type, label, main }]; onPick(type).
export function MainChips({ items, onPick, labelledBy, label, className = '', chipClass = '' }) {
  const keys = (e, i) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = items[(i + step + items.length) % items.length];
    onPick(next.type);
    const group = e.currentTarget.parentElement;
    const btn = group && group.querySelector(`[data-type="${next.type}"]`);
    if (btn) btn.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={className}>
      {items.map((c, i) => (
        <button
          key={c.type}
          type="button"
          role="radio"
          aria-checked={c.main}
          tabIndex={c.main ? 0 : -1}
          data-type={c.type}
          className={`${chipClass}${c.main ? ' on' : ''}`}
          onClick={() => { if (!c.main) onPick(c.type); }}
          onKeyDown={(e) => keys(e, i)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
