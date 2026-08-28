import { useEffect, useState } from 'react';

// Emoji and unicode symbols (🔊, ▶, ⚙, ⤢, etc.) render using each
// device's own font/emoji set, which is exactly why the same character
// looks different on iOS vs Android vs Windows vs a Samsung phone. These
// are plain inline SVGs instead — every path is drawn by this app, not
// by the OS, so they look identical everywhere. currentColor means each
// one automatically matches whatever text color its button already has.
//
// Each icon also accepts an optional `src` — when admin has uploaded a
// replacement image for that specific icon (see /admin/player-icons),
// this renders that image instead of the built-in SVG. Every consumer
// gets this behavior automatically via usePlayerIconOverrides() below,
// without needing its own fetch or fallback logic.

// Self-fetches admin-uploaded icon overrides once, shared by every player
// component that renders these icons. Same self-fetch pattern HeaderNav
// already uses for site settings — simpler than threading this through
// every page's getServerSideProps just because it happens to render a
// player somewhere on it. Missing/unset icons simply return undefined,
// which each icon component treats as "use the default SVG."
export function usePlayerIconOverrides() {
  const [overrides, setOverrides] = useState({});
  useEffect(() => {
    let cancelled = false;
    fetch('/api/player-icons')
      .then((r) => (r.ok ? r.json() : { icons: {} }))
      .then((d) => { if (!cancelled) setOverrides(d.icons || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return overrides;
}

function IconImage({ src, size }) {
  return <img src={src} width={size} height={size} style={{ objectFit: 'contain', display: 'block' }} alt="" />;
}

export function PlayIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}

export function VolumeIcon({ muted, src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none" />
      {muted ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M16 8a5 5 0 0 1 0 8" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}

export function SearchIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function BellIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function InfoIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// active=true -> saved/wishlisted (filled heart). active=false -> not yet
// saved (outline heart). Two separate override keys (heart_active,
// heart_inactive) rather than one, since a custom design might want a
// completely different shape for each state, not just a color swap.
export function HeartIcon({ active, src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return active ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z" />
    </svg>
  );
}

export function SettingsIcon({ src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// expanded=true means "currently fullscreen" -> show the exit (inward
// arrows) icon. expanded=false means "not fullscreen yet" -> show the
// enter (outward arrows) icon.
export function FullscreenIcon({ expanded, src, size = 18 }) {
  if (src) return <IconImage src={src} size={size} />;
  return expanded ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
