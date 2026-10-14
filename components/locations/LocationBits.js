import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import HeaderNav from '../HeaderNav';
import MobileTabBar from '../MobileTabBar';
import Footer from '../Footer';
import { SITE } from '../../lib/siteConfig';
import { dayCount } from '../../lib/locationRules';

// Shared pieces for the Locations pages (mockups/locations-v1.html):
// the page shell, status pills, a month calendar, and the photo
// downsizer the listing form uses before uploading.

export function LocationShell({ title, description, children, mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber, wide = true }) {
  return (
    <>
      <Head>
        <title>{title} — Locations — {SITE.name}</title>
        <meta name="description" content={description || 'Homes, warehouses, cafés, studios and odd corners of the city, listed by the people who hold the keys.'} />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <main id="main-content" className={`stage stage-single crew-page loc-page${wide ? '' : ' loc-narrow'}`}>{children}</main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

// "Hosted 6" / "New host": shoots that went as agreed, on the host card.
export function HostedChip({ host }) {
  if (!host) return null;
  const n = host.hosted || 0;
  return <span className={`crew-chip ${n > 0 ? 'olive' : 'sky'}`} title={n > 0 ? `${n} ${n === 1 ? 'shoot' : 'shoots'} went as agreed` : 'No completed shoots yet'}>{n > 0 ? `Hosted ${n}` : 'New host'}</span>;
}

export const STATUS_LABEL = { pending: 'In review', listed: 'Listed', paused: 'Paused', rejected: 'Not approved', removed: 'Removed' };

export function StatusPill({ status }) {
  const cls = status === 'listed' ? 'ok' : status === 'pending' ? 'olive' : status === 'rejected' ? 'warn' : 'mute';
  return <span className={`crew-chip ${cls}`}>{STATUS_LABEL[status] || status}</span>;
}

export const fmtDay = (iso, opts = { month: 'short', day: 'numeric' }) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
export function fmtRange(a, b) {
  if (!a) return '';
  return !b || b === a ? fmtDay(a) : `${fmtDay(a)}–${fmtDay(b)}`;
}
export function hoursLabel(from, to) {
  const f = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
  };
  if (!from && !to) return 'Any hours';
  return `${f(from) || '…'} – ${f(to) || '…'}`;
}

// A month at a time. `marks` is { 'YYYY-MM-DD': 'booked' | 'blocked' |
// 'sel' | 'req' }; days before `min` are greyed. onPick(iso) for a tap.
export function MonthCalendar({ month, onMonth, marks = {}, min = null, onPick, legend = true }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysIn; d += 1) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const shift = (n) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="loc-cal">
      <div className="loc-cal-head">
        <button type="button" className="crew-btn sm ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <span>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
        <button type="button" className="crew-btn sm ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="loc-cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="h">{d}</span>)}
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} className="e" />;
          const past = min && iso < min;
          const mark = marks[iso] || (past ? 'past' : 'open');
          return (
            <button key={iso} type="button" className={`d ${mark}`} disabled={past || !onPick} onClick={() => onPick && onPick(iso)} aria-label={`${fmtDay(iso, { month: 'long', day: 'numeric' })}${mark !== 'open' ? ` · ${mark}` : ''}`}>
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
      {legend && (
        <div className="loc-cal-legend">
          <span><i className="open" />Open</span><span><i className="booked" />Booked</span><span><i className="blocked" />Blocked</span><span><i className="sel" />Your dates</span>
        </div>
      )}
    </div>
  );
}

export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every day in a range, inclusive.
export function daysBetween(a, b) {
  const n = dayCount(a, b);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(new Date(Date.parse(`${a}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  return out;
}

// Reads a picked file and shrinks it to a JPEG no wider than `max` px, as
// a data URL — gallery photos come off phones at 4000px and 5 MB, which
// is more than an upload needs and more than a request may carry.
export function shrinkImage(file, max = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file isn’t an image.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1200000) { resolve(reader.result); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadImage(file, purpose = 'photo') {
  const base64 = await shrinkImage(file, purpose === 'proof' ? 2000 : 1600);
  const res = await fetch('/api/locations/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', purpose }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data.url;
}

// The listing's photo strip with the cover first.
export function PhotoStrip({ photos, onChange, max, busy }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className={`loc-photos${dragging ? ' drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); }}>
      {photos.map((p, i) => (
        <div key={p.url} className="loc-photo">
          <img src={p.url} alt="" />
          {i === 0 && <span className="loc-photo-cover">Cover</span>}
          <input type="text" className="crew-input" value={p.caption} placeholder="Living room · 4pm" maxLength={80} onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
          <div className="loc-photo-acts">
            {i > 0 && <button type="button" className="crew-btn sm ghost" onClick={() => onChange([p, ...photos.filter((_, j) => j !== i)])}>Make cover</button>}
            <button type="button" className="crew-btn sm ghost" onClick={() => onChange(photos.filter((_, j) => j !== i))} aria-label="Remove photo">✕</button>
          </div>
        </div>
      ))}
      {photos.length < max && (
        <label className="loc-photo-add">
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={busy} onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) onChange(files); }} />
          <span>{busy ? 'Uploading…' : `+ Add photos`}</span>
          <small>{photos.length} of {max}</small>
        </label>
      )}
    </div>
  );
}

export function Crumbs({ items }) {
  return (
    <div className="crew-crumbs">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span>/</span>}
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span>{it.label}</span>}
        </span>
      ))}
    </div>
  );
}
