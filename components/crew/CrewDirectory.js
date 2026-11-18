import Link from 'next/link';
import SignInHere from '../SignInHere';
import TierChip from './TierChip';
import { Avatar } from './CrewBits';
import { personRow, personStatus, castRow, callRow, gearRow, emptyLine, freeStrip, hoursLabel, FREE_HOURS, CREW_WORDS } from '../../lib/crewDirectoryRules';

// Crew Call, simpler (2026-11-18, mockups/crew-call-simpler-contract.md):
// the rows, the "Free right now?" strip, the nudge and the empty line of
// /crew. Every word, count and line comes from lib/crewDirectoryRules.js;
// this file only draws them. Styles are the .ccx-* block in globals.css.
// One markup serves both widths: a list of rows on a phone, cards in a
// grid from 900px (CSS).

/* ---------------- icons (inline, stroke) ---------------- */

const svg = (size, children, extra = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...extra}>{children}</svg>
);
export const IdCardIcon = ({ size = 20 }) => svg(size, <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4" /><path d="M14.5 10h4M14.5 13.5h3" /></>);
export const PlusIcon = ({ size = 20 }) => svg(size, <path d="M12 5v14M5 12h14" />, { strokeWidth: 2.4 });
export const SearchIcon = ({ size = 16 }) => svg(size, <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const PinIcon = ({ size = 14 }) => svg(size, <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>, { strokeWidth: 2.2 });
export const MessageIcon = ({ size = 17 }) => svg(size, <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10.5l-4 3.5V16a2 2 0 0 1-2-2z" />);
export const CloseIcon = ({ size = 14 }) => svg(size, <path d="M6 6l12 12M18 6L6 18" />, { strokeWidth: 2.4 });
export const LocateIcon = ({ size = 18 }) => svg(size, <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>);
const BoltIcon = ({ size = 16 }) => svg(size, <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />);
const MegaphoneIcon = ({ size = 30 }) => svg(size, <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6" /></>);
const PeopleIcon = ({ size = 30 }) => svg(size, <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.5c2.3.1 3.9 1.5 4.5 4" /></>);
const StarIcon = ({ size = 30 }) => svg(size, <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />);

// A category's tile on the Gear tab, in gold.
const GEAR_ICONS = {
  Camera: <><rect x="3.5" y="7" width="17" height="12" rx="2" /><circle cx="12" cy="13" r="3.2" /><path d="M8.5 7l1.5-2.5h4L15.5 7" /></>,
  Lenses: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /></>,
  Lighting: <><path d="M9 3h6l-1 6h-4z" /><path d="M12 9v12M8 21h8" /><path d="M5 5l2 2M19 5l-2 2" /></>,
  Audio: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></>,
  'Grip & support': <><path d="M12 4v10M12 14l-6 7M12 14l6 7M12 14v7" /><path d="M12 6h7M19 6v3" /></>,
  Drone: <><rect x="9" y="10" width="6" height="4" rx="1" /><path d="M4 7h5M15 7h5M6.5 7v3M17.5 7v3M9 12H6.5M15 12h2.5" /></>,
  Monitors: <><rect x="3.5" y="4.5" width="17" height="11" rx="1.5" /><path d="M12 15.5V20M8 20h8" /></>,
  'Space & vehicles': <><rect x="2.5" y="8" width="13" height="9" rx="1.5" /><path d="M15.5 11h3l3 3v3h-6z" /><circle cx="7" cy="18.5" r="1.6" /><circle cx="18" cy="18.5" r="1.6" /></>
};
export function GearCategoryIcon({ category, size = 22 }) {
  return svg(size, GEAR_ICONS[category] || GEAR_ICONS.Camera);
}

const EMPTY_ICONS = { calls: MegaphoneIcon, people: PeopleIcon, cast: StarIcon, gear: ({ size }) => <GearCategoryIcon category="Camera" size={size} /> };

/* ---------------- small pieces ---------------- */

// A photo at its focal point and zoom (the site's rule), sized by CSS.
function Face({ person, size, mark, className = '' }) {
  return (
    <span className={`ccx-face ${className}${mark === 'free' ? ' free' : ''}`} style={{ '--face': `${size}px` }} aria-hidden="true">
      <Avatar userId={person.userId} name={person.displayName} src={person.avatarUrl} position={person.avatarPosition} zoom={person.avatarZoom} size="sm" />
      {mark === 'open' && <span className="ccx-dot" />}
    </span>
  );
}

function messageHref(userId, kind, label) {
  return `/messages?to=${encodeURIComponent(userId)}&kind=${kind}&label=${encodeURIComponent(label)}`;
}

// "Message" / "Ask": opens (or starts) the conversation with what it is
// about attached. Signed out, it opens sign-in and stays on the page.
function MessageButton({ signedIn, userId, kind, label, className, aria, children }) {
  if (!signedIn) return <SignInHere><button type="button" className={className} aria-label={aria}>{children}</button></SignInHere>;
  return <Link href={messageHref(userId, kind, label)} className={className} aria-label={aria}>{children}</Link>;
}

// "⚡ Free until 6 PM" is a clock time in the viewer's own zone, which the
// server can't know: until the page has hydrated the row says "⚡ Free
// right now" (the same rule, without the time), so the two renders match.
function statusFor(p, hydrated) {
  return hydrated ? personStatus(p) : personStatus({ ...p, availableNowUntil: null });
}

function StatusMeta({ status, meta }) {
  if (!status && !meta) return null;
  return (
    <span className="ccx-p-status">
      {status && <span className={`ccx-tone-${status.tone}`}>{status.text}</span>}
      {status && meta ? ' · ' : ''}
      {meta}
    </span>
  );
}

/* ---------------- a call ---------------- */

export function CallRowItem({ c }) {
  const row = callRow(c);
  const poster = c.poster || {};
  return (
    <Link href={`/crew/calls/${c.id}`} className={`ccx-row ccx-call${row.urgent ? ' urgent' : ''}`}>
      {row.tags.length > 0 && (
        <span className="ccx-tags">
          {row.tags.map((t, i) => (
            <span key={t.text} className={`ccx-tag ccx-tone-${t.tone}`}>{i > 0 ? ' · ' : ''}{t.text}</span>
          ))}
        </span>
      )}
      <span className="ccx-call-title">{row.title}</span>
      <span className="ccx-call-meta">{row.meta}</span>
      <span className="ccx-call-foot">
        <span className={`ccx-pay ccx-pay-${row.pay.tone}`}>{row.pay.text}</span>
        {row.poster && (
          <>
            <span aria-hidden="true">·</span>
            <span className="ccx-poster">
              <Face person={poster} size={18} className="ccx-poster-face" />
              {row.poster}
            </span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>{row.answered}</span>
      </span>
    </Link>
  );
}

/* ---------------- a person (People B) ---------------- */

export function PersonRowItem({ p, signedIn, hydrated }) {
  const row = personRow(p);
  const status = statusFor(p, hydrated);
  return (
    <article className="ccx-row ccx-person">
      <Link href={p.profilePath} className="ccx-p-main">
        <Face person={p} size={52} mark={row.mark} className="ccx-p-face" />
        <span className="ccx-p-lines">
          <span className="ccx-p-name">
            <span className="ccx-p-name-text">{row.name}</span>
            {p.tier && <TierChip person={p} />}
            {row.verified && <span className="ccx-ver">✓ creator</span>}
          </span>
          {row.roles && <span className="ccx-p-roles">{row.roles}</span>}
          <StatusMeta status={status} meta={row.meta} />
          {row.gear && (
            <span className="ccx-p-gear"><span className={`ccx-verb ccx-tone-${row.gear.tone}`}>{row.gear.verb}</span> {row.gear.text}</span>
          )}
        </span>
      </Link>
      {row.bio && <p className="ccx-p-bio">{row.bio}</p>}
      <div className="ccx-p-acts">
        <MessageButton signedIn={signedIn} userId={p.userId} kind="card" label={row.messageLabel} className="ccx-msg" aria={`${CREW_WORDS.message} ${row.name}`}>
          <MessageIcon /><span className="ccx-msg-label">{CREW_WORDS.message}</span>
        </MessageButton>
        <Link href={p.profilePath} className="ccx-pill-ghost ccx-profile-pill">{CREW_WORDS.profile}</Link>
      </div>
    </article>
  );
}

/* ---------------- a performer (Cast B) ---------------- */

export function CastRowItem({ p, signedIn, hydrated }) {
  const row = castRow(p);
  const status = statusFor(p, hydrated);
  return (
    <article className="ccx-row ccx-person ccx-cast">
      <Link href={p.profilePath} className="ccx-p-main">
        <span className={`ccx-shot${row.mark === 'free' ? ' free' : ''}`} aria-hidden="true">
          {row.headshot
            ? <img src={row.headshot} alt="" loading="lazy" draggable={false} />
            : <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />}
        </span>
        <span className="ccx-p-lines">
          <span className="ccx-p-name">
            <span className="ccx-p-name-text">{row.name}</span>
            {p.tier && <TierChip person={p} />}
          </span>
          {row.playing && <span className="ccx-p-roles">{row.playing}</span>}
          <StatusMeta status={status} meta={row.meta} />
        </span>
      </Link>
      <div className="ccx-p-acts">
        <MessageButton signedIn={signedIn} userId={p.userId} kind="card" label={row.messageLabel} className="ccx-msg" aria={`${CREW_WORDS.message} ${row.name}`}>
          <MessageIcon /><span className="ccx-msg-label">{CREW_WORDS.message}</span>
        </MessageButton>
      </div>
    </article>
  );
}

/* ---------------- a piece of gear ---------------- */

export function GearRowItem({ g, signedIn }) {
  const row = gearRow(g);
  const o = g.owner || {};
  return (
    <article className="ccx-row ccx-gear">
      <span className="ccx-gear-tile" aria-hidden="true"><GearCategoryIcon category={g.category} /></span>
      <span className="ccx-gear-lines">
        <span className="ccx-gear-name">{row.name}</span>
        <span className="ccx-gear-cat">{row.category}{row.category ? ' · ' : ''}<span className={`ccx-tone-${row.flag.tone}`}>{row.flag.text}</span></span>
        {o.profilePath
          ? <Link href={o.profilePath} className="ccx-gear-owner"><Face person={o} size={18} />{row.owner}</Link>
          : <span className="ccx-gear-owner"><Face person={o} size={18} />{row.owner}</span>}
      </span>
      {o.userId && (
        <MessageButton signedIn={signedIn} userId={o.userId} kind="gear" label={row.name} className="ccx-ask" aria={`${CREW_WORDS.ask} ${row.owner.split(' · ')[0]} about ${row.name}`}>
          {CREW_WORDS.ask}
        </MessageButton>
      )}
    </article>
  );
}

/* ---------------- empty, the strip, the nudge ---------------- */

export function EmptyList({ tab, filtered, signedIn, hasCard }) {
  const e = emptyLine(tab, { filtered, signedIn, hasCard });
  const Icon = EMPTY_ICONS[tab] || PeopleIcon;
  return (
    <div className="ccx-empty">
      <span className="ccx-empty-icon"><Icon size={30} /></span>
      <h2>{e.title}</h2>
      <p>{e.line}</p>
    </div>
  );
}

// "Free right now?" — for someone with a card, on the Calls tab. On a
// phone a strip whose button turns into the four choices; from 900px a
// side card with the choices always showing (CSS).
export function FreeStrip({ until, hydrated, busy, choosing, onChoose, onSet, error }) {
  const s = freeStrip(until);
  const title = s.on && !hydrated ? CREW_WORDS.freeNowLong : s.title;
  return (
    <section className={`ccx-free${s.on ? ' on' : ''}${choosing ? ' choosing' : ''}`} aria-label={CREW_WORDS.free.ask}>
      <span className="ccx-free-icon" aria-hidden="true"><BoltIcon size={16} /></span>
      <span className="ccx-free-text">
        <span className="ccx-free-title" role="status">{title}</span>
        <span className="ccx-free-line short">{s.line}</span>
        <span className="ccx-free-line wide">{s.on ? s.line : CREW_WORDS.free.laptopLine}</span>
      </span>
      {s.on ? (
        <button type="button" className="ccx-free-btn" disabled={busy} onClick={() => onSet(0)}>{s.button}</button>
      ) : (
        <>
          <button type="button" className="ccx-free-btn ccx-free-open" disabled={busy} onClick={onChoose} aria-expanded={choosing}>{s.button}</button>
          <span className="ccx-free-hours" role="group" aria-label={CREW_WORDS.free.ask}>
            {FREE_HOURS.map((h) => (
              <button key={h} type="button" className="ccx-hour" disabled={busy} onClick={() => onSet(h)}>{hoursLabel(h)}</button>
            ))}
          </span>
        </>
      )}
      {error && <span className="ccx-free-error" role="alert">{error}</span>}
    </section>
  );
}

export function Nudge({ signedIn }) {
  const n = CREW_WORDS.nudge;
  return (
    <section className="ccx-nudge" aria-labelledby="ccx-nudge-title">
      <span className="ccx-nudge-icon" aria-hidden="true"><IdCardIcon size={18} /></span>
      <span className="ccx-nudge-text">
        <span id="ccx-nudge-title" className="ccx-nudge-title">{n.title}</span>
        <span className="ccx-nudge-line">{signedIn ? n.line : n.signedOutLine}</span>
      </span>
      {signedIn
        ? <Link href="/crew/card" className="ccx-nudge-btn">{n.button}</Link>
        : <SignInHere><button type="button" className="ccx-nudge-btn">{n.signIn}</button></SignInHere>}
    </section>
  );
}
