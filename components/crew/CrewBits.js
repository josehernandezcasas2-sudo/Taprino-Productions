import Link from 'next/link';
import { GEAR_FLAGS } from '../../lib/crewOptions';

// Small pieces shared by /crew, /crew/card and the profile page's
// "Working card" section. Styles are the .crew-* block in globals.css.

const AVATAR_COLORS = ['#f85f73', '#e7a255', '#93d0a4', '#8499dc', '#c85924', '#f2bf88', '#d67c51', '#84cd98'];

function colorFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

export function Avatar({ userId, name, src, size = 'md' }) {
  const cls = `crew-avatar crew-avatar-${size}`;
  if (src) return <img className={cls} src={src} alt="" />;
  return <span className={cls} style={{ background: colorFor(userId || name) }} aria-hidden="true">{initialsOf(name)}</span>;
}

export const flagClass = (flag) => (flag === 'lends' ? 'ok' : flag === 'brings' ? 'gear' : 'mute');
export const flagLabel = (flag) => GEAR_FLAGS[flag] || GEAR_FLAGS.brings;

export function rateLabel(card) {
  if (card.ratesHidden) return 'Sign in to see rates';
  if (card.rateMin == null && card.rateMax == null) return 'Rate on request';
  if (card.rateMin != null && card.rateMax != null && card.rateMin !== card.rateMax) return `$${card.rateMin}–${card.rateMax}/day`;
  return `$${card.rateMax == null ? card.rateMin : card.rateMax}/day`;
}

export function bookedLabel(card) {
  if (!card.bookedUntil) return 'Booked';
  const d = new Date(`${card.bookedUntil}T12:00:00`);
  return `Booked until ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function Availability({ card }) {
  const open = card.availability === 'open';
  return <span className={`crew-avail${open ? '' : ' busy'}`}><i />{open ? 'Open to work' : bookedLabel(card)}</span>;
}

export function RoleChips({ roles, empty }) {
  if (!roles || roles.length === 0) return empty ? <span className="crew-muted">{empty}</span> : null;
  return <div className="crew-chips">{roles.map((r) => <span key={r} className="crew-chip role">{r}</span>)}</div>;
}

export function GearRows({ gear, onRemove }) {
  if (!gear || gear.length === 0) return <span className="crew-muted">Nothing listed.</span>;
  return (
    <div className="crew-gear-rows">
      {gear.map((g, i) => (
        <div key={g.id || i} className="crew-gear-row">
          <span className="crew-cat">{g.category}</span>
          <span>{g.name}</span>
          <span className={`crew-chip ${flagClass(g.flag)}`}>{flagLabel(g.flag)}</span>
          {onRemove && <button type="button" className="crew-btn sm ghost" onClick={() => onRemove(i)} aria-label={`Remove ${g.name}`}>✕</button>}
        </div>
      ))}
    </div>
  );
}

export function CreditRows({ auto = [], manual = [], onRemove }) {
  if (auto.length === 0 && manual.length === 0) return <span className="crew-muted">No credits yet.</span>;
  return (
    <div className="crew-credits">
      {auto.map((w) => (
        <Link key={`${w.type}-${w.id}`} href={w.type === 'series' ? `/series/${w.id}` : `/episode/${w.id}`} className="crew-credit">
          <span>{w.title} <small>· {w.contentType === 'series' || w.type === 'series' ? 'Series' : w.contentType === 'movie' ? 'Film' : w.contentType === 'podcast' ? 'Podcast' : 'Short'}{w.createdAt ? ` · ${new Date(w.createdAt).getFullYear()}` : ''}</small></span>
          <span className="crew-chip ok">✓ on Studio Tapa</span>
        </Link>
      ))}
      {manual.map((c, i) => (
        <div key={c.id || i} className="crew-credit">
          <span>{c.title} <small>{c.role ? `· ${c.role}` : ''}{c.year ? ` · ${c.year}` : ''}</small></span>
          <span className="crew-credit-end">
            <span className="crew-chip mute">outside work</span>
            {onRemove && <button type="button" className="crew-btn sm ghost" onClick={() => onRemove(i)} aria-label={`Remove ${c.title}`}>✕</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// The read-only card, as it shows on a profile page.
export function CrewCardView({ card, creditedWork = [], isOwn = false }) {
  const facts = [];
  if (card.place) facts.push(`Based in ${card.place.label}${card.travelMiles ? ` · travels ${card.travelMiles} mi` : ''}`);
  if (card.remoteOk) facts.push('Remote OK');
  facts.push(rateLabel(card));
  if (card.languages.length) facts.push(card.languages.join(', '));
  return (
    <div className="crew-cardview">
      <div className="crew-pmeta">
        <Availability card={card} />
        {facts.map((f) => <span key={f}>{f}</span>)}
      </div>
      <RoleChips roles={card.roles} empty={isOwn ? 'No roles yet — add some on your card.' : 'No roles listed.'} />
      <div className="crew-cardview-block">
        <h4>Gear</h4>
        <GearRows gear={card.gear} />
      </div>
      <div className="crew-cardview-block">
        <h4>Credits</h4>
        <CreditRows auto={creditedWork} manual={card.credits} />
      </div>
      <div className="crew-actions">
        {isOwn && <Link href="/crew/card" className="crew-btn sm">Edit card</Link>}
        <Link href="/crew" className="crew-btn sm ghost">Find people on Crew Call →</Link>
      </div>
    </div>
  );
}
