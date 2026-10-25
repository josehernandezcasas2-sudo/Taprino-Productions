import Link from 'next/link';
import { Avatar } from '../crew/CrewBits';
import TierChip from '../crew/TierChip';

// Small pieces shared by /productions, a production's page and its call
// sheet. Styles are the .prod-* block in globals.css (on top of .crew-*).

export function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!a) return 'Dates to confirm';
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}

export function fmtDay(d) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

export function StatusPill({ status, label }) {
  return <span className={`prod-status s-${status}`}><i aria-hidden="true" />{label || status}</span>;
}

export function PersonLine({ p, after }) {
  if (!p) return null;
  return (
    <span className="cc-person">
      <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />
      <span>
        <Link href={p.profilePath}>{p.displayName}</Link>
        {p.verified && <span className="crew-ver"> ✓ creator</span>}{' '}
        <TierChip person={p} />
        {after}
      </span>
    </span>
  );
}

// One production in a list.
export function ProductionCard({ p, roles = null }) {
  return (
    <Link href={`/productions/${p.id}`} className="crew-panel prod-card">
      <div className="prod-card-top">
        <StatusPill status={p.status} label={p.statusLabel} />
        <span className="crew-chip">{p.kindLabel}</span>
        {p.release && <span className="crew-chip ok">on Studio Tapa</span>}
        {p.mine && <span className="crew-chip pink">yours</span>}
        {p.visibility && p.visibility !== 'public' && <span className="crew-chip mute">{p.visibility === 'crew' ? 'crew only' : 'private'}</span>}
      </div>
      <div className="prod-card-title">{p.title}</div>
      {p.logline && <p className="prod-card-log">{p.logline}</p>}
      <div className="cc-when">
        <span>{fmtRange(p.startsOn, p.endsOn)}</span>
        {p.place && <span>{p.place.label}</span>}
        {p.membersCount != null && <span>{p.membersCount} crew</span>}
        {p.openCalls > 0 && <span className="prod-open">{p.openCalls} open {p.openCalls === 1 ? 'call' : 'calls'}</span>}
        {roles && roles.length > 0 && <span>you: {roles.join(', ')}</span>}
      </div>
      {p.owner && (
        <div className="cc-owner">
          <Avatar userId={p.owner.userId} name={p.owner.displayName} src={p.owner.avatarUrl} position={p.owner.avatarPosition} zoom={p.owner.avatarZoom} size="sm" />
          <span>{p.owner.displayName} <TierChip person={p.owner} /></span>
        </div>
      )}
    </Link>
  );
}
