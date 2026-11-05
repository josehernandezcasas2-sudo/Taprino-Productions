import { useState } from 'react';

// Shared pieces of Admin → Security and AI security (2026-11-05;
// pages/admin/security.js, pages/admin/ai-security.js). Styles: .sec-*
// in styles/globals.css.

// Dates in Pacific time, so the server's render and the browser's agree.
export function shortDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

export function Chip({ tone = 'muted', children }) {
  return <span className={`sec-chip ${tone}`}>{children}</span>;
}

export function Tile({ label, value, tone = 'plain' }) {
  return (
    <div className="sec-tile">
      <span className="sec-tile-label">{label}</span>
      <span className={`sec-tile-value ${tone}`}>{value}</span>
    </div>
  );
}

export function Card({ eyebrow, title, id, wide = false, children }) {
  return (
    <section className={`sec-card${wide ? ' wide' : ''}`} aria-labelledby={id}>
      {eyebrow && <p className="sec-eyebrow">{eyebrow}</p>}
      <h2 className="sec-h" id={id}>{title}</h2>
      {children}
    </section>
  );
}

// The switches' state for one page: flip(field, value) posts it and takes
// the fresh view the API answers with.
export function useSwitches(initial) {
  const [switches, setSwitches] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  async function flip(field, value) {
    setBusy(field);
    setErrors((e) => ({ ...e, [field]: null }));
    try {
      const res = await fetch('/api/admin/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ field, value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t save that.');
      setSwitches(data.switches);
    } catch (err) {
      setErrors((e) => ({ ...e, [field]: err.message }));
    } finally {
      setBusy(null);
    }
  }
  return { switches, busy, errors, flip };
}

// One switch with its words. `state` is { on, needsMigration, forced… }
// from lib/securityPage.js; `lock` is the reason it can't be flipped
// from here right now, if any.
export function SwitchRow({ field, title, state, chipOn = 'On', chipOff = 'Off', toneOn = 'on', toneOff = 'warn', busy, error, onFlip, lock = null, badge = null, children, first = false }) {
  const on = Boolean(state && state.on);
  const disabled = Boolean(busy) || Boolean(lock) || Boolean(state && state.needsMigration);
  const chip = busy === field ? 'Saving…' : on ? chipOn : chipOff;
  return (
    <div className={`sec-row${first ? ' first' : ''}`} data-testid={`switch-${field}`}>
      <div className="sec-row-text">
        <p className="sec-row-title">
          <span>{title}</span>
          <Chip tone={busy === field ? 'muted' : on ? toneOn : toneOff}>{chip}</Chip>
          {badge}
        </p>
        {children}
        {state && state.needsMigration && <p className="sec-note">This switch needs a database update first (migration {field === 'screenCaptureBlock' ? 115 : 119}).</p>}
        {lock && <p className="sec-note">{lock}</p>}
        {error && <p className="sec-error" role="alert">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        className={`sec-switch${on ? ' on' : ''}`}
        disabled={disabled}
        onClick={() => onFlip(field, !on)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

// A "bring older uploads behind the locks" run (moved here from Admin →
// Settings → Protection). Each is safe to run again.
export function ProtectionRun({ title, blurb, lastRun, label, busyLabel, url, body, render }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [ranNow, setRanNow] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not finish.');
      setResult(data);
      setRanNow(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const done = ranNow || Boolean(lastRun);
  return (
    <div className="sec-run">
      <div className="sec-run-text">
        <p className="sec-row-title"><span>{title}</span></p>
        <p className="sec-p small">{blurb}</p>
      </div>
      <Chip tone={done ? 'ok' : 'warn'}>{ranNow ? 'Just ran' : lastRun ? `Ran ${shortDay(lastRun.at)}${lastRun.by ? ` · ${lastRun.by.split('@')[0]}` : ''}` : 'Not run yet'}</Chip>
      <button type="button" className="sec-btn" onClick={run} disabled={busy}>{busy ? busyLabel : done ? 'Run again' : label}</button>
      {(error || result) && (
        <div className="sec-run-result">
          {error && <p className="sec-error" role="alert">{error}</p>}
          {result && render(result)}
        </div>
      )}
    </div>
  );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function VideosResult({ result }) {
  return (
    <>
      <p>Protected {plural(result.videos, 'video')} across {plural(result.protected, 'title')}; {result.skipped} without a Cloudflare video; {result.failures.length} failed.</p>
      {result.failures.length > 0 && <ul>{result.failures.map((f) => <li key={f.id}>{f.title}: {f.error}</li>)}</ul>}
      {result.university && (
        <p>Film University: {plural(result.university.videos, 'video')} protected, {plural(result.university.framesReplaced, 'Cloudflare frame')} stored as real thumbnails{result.university.failures.length ? `, ${result.university.failures.length} failed: ${result.university.failures.map((f) => `${f.title} (${f.error})`).join('; ')}` : ''}.</p>
      )}
      {result.extra && <p>Snippets and self-tapes: {plural(result.extra.posts, 'snippet')} and {plural(result.extra.tapes, 'self-tape')} protected, {plural(result.extra.framesStored, 'frame')} stored{result.extra.failures.length ? `, ${result.extra.failures.length} failed: ${result.extra.failures.map((f) => `${f.title} (${f.error})`).join('; ')}` : ''}.</p>}
      {result.cloudflarePosters.length > 0 && (
        <p className="warn">
          {result.cloudflarePosters.length} title{result.cloudflarePosters.length === 1 ? ' uses' : 's use'} Cloudflare&rsquo;s frame grab as a poster and need{result.cloudflarePosters.length === 1 ? 's' : ''} a real one uploaded: {result.cloudflarePosters.map((p) => p.title).join(', ')}.
        </p>
      )}
    </>
  );
}

export function CaptionsResult({ result }) {
  return (
    <>
      <p>Moved {result.moved}; {result.alreadyPrivate} already private; {result.skipped.length} hosted elsewhere; {result.failures.length} failed.</p>
      {result.failures.length > 0 && <ul>{result.failures.map((f) => <li key={f.id}>{f.title}: {f.error}</li>)}</ul>}
    </>
  );
}

export function UniversityResult({ result }) {
  return <p>{result.wasPublic ? 'The bucket was public and is now private.' : result.existed ? 'The bucket was already private.' : 'Created the bucket private.'}</p>;
}

export function PostsResult({ result }) {
  return (
    <>
      <p>Moved {plural(result.moved, 'image')} ({result.resized} brought down to 1600px); {result.alreadyPrivate} already private; {result.skipped.length} hosted elsewhere; {result.failures.length} failed.</p>
      {result.failures.length > 0 && <ul>{result.failures.map((f, i) => <li key={`${f.id}-${i}`}>{f.title}: {f.error}</li>)}</ul>}
    </>
  );
}
