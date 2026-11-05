import { useEffect, useRef, useState } from 'react';
import { attachHeroTrailer } from '../../HeroSpotlight';
import { LockIcon, PlayIcon } from '../../PlayerIcons';

// Small pieces the admin show page's cards share (the series revamp,
// slice 3a: mockups/series-slice3a-contract.md §5). The cards live in
// components/show/admin/*: they take `admin` (GET /api/admin/show/[id]),
// `view` (the room's GET /api/show/[id]), `onAction(action, body)` (POST
// /api/admin/show/[id], answering { ok, status, data, error }), `onDone()`
// (reload both) and `say(toast)` (the room's toast).

// One admin card: a heading in the room's small-caps style and its body.
export function AdmCard({ id = null, k, level = null, children, className = '', labelledBy = null }) {
  const headId = labelledBy || (id ? `${id}-k` : undefined);
  return (
    <section id={id || undefined} className={`show-side-card show-adm-card ${level ? `level-${level}` : ''} ${className}`.trim()} aria-labelledby={headId}>
      {k ? <h2 className="show-side-k show-adm-k" id={headId}>{k}</h2> : null}
      {children}
    </section>
  );
}

// Why a control is off ("Needs “Review creator submissions”.").
export function NeedLine({ line }) {
  if (!line) return null;
  return <p className="show-adm-need"><LockIcon size={11} /> <span>{line}</span></p>;
}

// An action's own answer, under it.
export function ErrorLine({ text }) {
  if (!text) return null;
  return <p className="show-adm-error" role="alert">{text}</p>;
}

// An inline form a button opens (Hold…, Take down…, Deny…): its first
// field takes the focus (autoFocus), Escape closes it like Cancel, and
// closing puts the focus back on the button that opened it.
//   const [openerRef, focusOpener] = useOpener();
//   <button ref={openerRef} …>Hold…</button>
//   <div className="show-adm-form" onKeyDown={onEscape(close)}>…
export function useOpener() {
  const ref = useRef(null);
  const focusBack = () => {
    setTimeout(() => {
      if (ref.current && typeof ref.current.focus === 'function') ref.current.focus();
    }, 0);
  };
  return [ref, focusBack];
}

export function onEscape(close) {
  return (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
}

const TZ = 'America/Los_Angeles';

// "Nov 4" in the studio's time zone, like every other date on the site.
export function dayWords(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
  } catch {
    return null;
  }
}

// "Nov 4, 3:12 pm" (History).
export function stampWords(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(/\s?([AP])M$/i, (m, x) => ` ${x.toLowerCase()}m`);
    return `${day}, ${time}`;
  } catch {
    return '';
  }
}

// "2 years old", "3 months old", "12 days old", "new today".
export function ageWords(days) {
  const n = Number(days);
  if (days === null || days === undefined || !Number.isFinite(n) || n < 0) return null;
  if (n < 1) return 'new today';
  if (n < 60) return `${Math.floor(n)} day${Math.floor(n) === 1 ? '' : 's'} old`;
  if (n < 730) return `${Math.floor(n / 30)} months old`;
  return `${Math.floor(n / 365)} years old`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// "S1 E1–E12" from ['S1 E1', 'S1 E2', …]; a few seasons are joined with a
// dot ("S1 E1–E3, E5 · S2 E1").
export function codesLine(codes) {
  const bySeason = new Map();
  for (const c of codes || []) {
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
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      runs.push(start === prev ? `E${start}` : `E${start}–E${prev}`);
      start = n;
      prev = n;
    }
    runs.push(start === prev ? `E${start}` : `E${start}–E${prev}`);
    out.push(`S${s} ${runs.join(', ')}`);
  }
  return out.join(' · ');
}

// What Cloudflare says about a file, in plain words.
export function fileStateWords(state) {
  switch (state) {
    case 'ready': return 'Ready';
    case 'audio': return 'Audio';
    case 'external': return 'Ready (its own address)';
    case 'processing': return 'Still processing';
    case 'uploading': return 'Still uploading';
    case 'error': return 'Failed to process';
    case 'deleted': return 'Gone from Cloudflare';
    case 'none': return 'No file';
    default: return 'Cloudflare hasn’t said yet';
  }
}

// A reviewer's player for a signed video: nothing loads until Play is
// pressed (a card can list several). `media` = { src, iframe } (a new file:
// Cloudflare's own player plays everywhere) or { src, expiresAt } (a
// trailer: a signed HLS manifest, played through hls.js like the heroes).
export function SignedClip({ media, label }) {
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef(null);
  const src = media && media.src ? media.src : null;
  const iframe = media && media.iframe ? media.iframe : null;
  useEffect(() => {
    if (!on || iframe || !src || !videoRef.current) return undefined;
    return attachHeroTrailer(videoRef.current, src, { muted: false, paused: false, onFatal: () => setFailed(true) });
  }, [on, iframe, src]);
  if (!src && !iframe) return <div className="show-adm-clip is-empty"><span>None</span></div>;
  if (!on) {
    return (
      <button type="button" className="show-adm-clip is-idle" onClick={() => setOn(true)} aria-label={`Play ${label}`}>
        <PlayIcon size={22} />
      </button>
    );
  }
  if (iframe) {
    return <div className="show-adm-clip"><iframe src={iframe} title={label} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>;
  }
  return (
    <div className="show-adm-clip">
      {failed ? <span className="show-adm-clip-fail">It won’t play — reload the page for a fresh link.</span> : <video ref={videoRef} controls playsInline preload="none" aria-label={label} />}
    </div>
  );
}
