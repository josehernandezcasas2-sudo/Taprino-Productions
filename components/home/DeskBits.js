import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { Avatar } from '../crew/CrewBits';
import { AVAILABLE_NOW_CHOICES } from '../../lib/crewCallRules';
import { LANES, LANE_ORDER, dollars } from '../../lib/creatorMoneyRules';

// The desk column of the Connect homepage (pages/index.js, direction I of
// the 2026-10-28 canvas): the pieces that talk to the server from the
// browser. Everything static about the desk is rendered by the page from
// lib/homeFeed.js's `desk`; these are the switch, the follow buttons and
// the two cards that read a creator-only API.

// "I'm free right now" (migration 105): one tap flags the viewer's card
// for the first choice of hours; a second tap clears it.
export function FreeNowButton({ until, hasCard, compact = false }) {
  const [state, setState] = useState({ until: until || null, busy: false, error: null });
  useEffect(() => { setState((s) => ({ ...s, until: until || null })); }, [until]);
  const on = state.until && Date.parse(state.until) > Date.now();
  async function toggle() {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch('/api/crew/available-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours: on ? 0 : AVAILABLE_NOW_CHOICES[0] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update that.');
      setState({ until: data.availableNowUntil || null, busy: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
    }
  }
  if (!hasCard) {
    return <Link href="/crew/card" className="hb-free-btn">Make a working card →</Link>;
  }
  return (
    <>
      <button type="button" className={`hb-free-btn${on ? ' on' : ''}${compact ? ' compact' : ''}`} onClick={toggle} disabled={state.busy} aria-pressed={on}>
        <span className="hb-free-dot" aria-hidden="true" />
        {on ? `Free until ${timeLabel(state.until)} · stop` : "I'm free right now"}
      </button>
      {state.error && <p className="hb-error">{state.error}</p>}
    </>
  );
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Faces to follow: one button per person, through /api/profile-follow.
// Signed out, the button opens Clerk's sign-in.
export function FollowList({ people, isSignedIn }) {
  const router = useRouter();
  const { openSignIn } = useClerk();
  const [following, setFollowing] = useState({});
  const [busy, setBusy] = useState(null);
  async function toggle(userId) {
    if (!isSignedIn) { openSignIn({ redirectUrl: router.asPath }); return; }
    setBusy(userId);
    try {
      const res = await fetch('/api/profile-follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ followedId: userId }) });
      const data = await res.json();
      if (res.ok) setFollowing((f) => ({ ...f, [userId]: Boolean(data.following) }));
    } finally {
      setBusy(null);
    }
  }
  if (!people.length) return null;
  return (
    <div className="hb-desk-card">
      <div className="hb-desk-label sky">Faces to follow</div>
      {people.map((p) => (
        <div key={p.userId} className="hb-follow-row">
          <Link href={p.profilePath} className="hb-follow-who">
            <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />
            <span><b>{p.displayName}</b><small>{p.why}</small></span>
          </Link>
          <button type="button" className={`hb-follow-btn${following[p.userId] ? ' on' : ''}`} onClick={() => toggle(p.userId)} disabled={busy === p.userId}>
            {following[p.userId] ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
    </div>
  );
}

// This month's money, from the creator's own Money page data. The API
// answers 403 for anyone without a lane of their own, and the card
// simply doesn't render then.
export function DeskMoney() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/creator/money').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d && !d.error) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  // Every lane with money this month, else the first three, so the card
  // reads the same for a creator who earned nothing yet.
  const all = LANE_ORDER.filter((k) => k !== 'payouts' && data.lanes && data.lanes[k] && (k !== 'bookings' || data.lanes[k].shows));
  const withMoney = all.filter((k) => data.lanes[k].monthCents > 0);
  const lanes = withMoney.length ? withMoney : all.slice(0, 3);
  const next = data.top && data.top.nextPayout;
  return (
    <div className="hb-desk-card">
      <div className="hb-desk-label">This month</div>
      <div className="hb-money-total">{dollars(data.top.monthCents)}</div>
      <div className="hb-money-rows">
        {lanes.slice(0, 4).map((k) => (
          <span key={k} className={`hb-money-row lane-${k}`}><span>{LANES[k] ? LANES[k].label : k}</span><b>{dollars(data.lanes[k].monthCents)}</b></span>
        ))}
      </div>
      <p className="hb-desk-foot">
        {data.top.owedCents > 0 ? `${dollars(data.top.owedCents)} owed` : 'Nothing owed yet'}{next && next.willPay ? ' · pays on the 1st' : ''} · <Link href="/creator/money">Money page</Link>
      </p>
    </div>
  );
}

// The creator's own link and what it has done so far (lib/creatorShare.js
// getReferralStats through /api/creator/referrals; creators and admins).
export function DeskLink() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/creator/referrals').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d && d.linkPath && d.available !== false) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const full = `${typeof window === 'undefined' ? '' : window.location.origin}${data.linkPath}`;
  const shown = full.replace(/^https?:\/\/(www\.)?/, '');
  async function copy() {
    try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (err) { /* older browsers */ }
  }
  return (
    <div className="hb-desk-card">
      <div className="hb-desk-label">Your link</div>
      <div className="hb-link-row">
        <span className="hb-link-text">{shown}</span>
        <button type="button" className="hb-link-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="hb-desk-foot">{data.joined === 1 ? '1 person joined' : `${data.joined || 0} people joined`} through it{data.joined ? ` · ${data.active} still ${data.active === 1 ? 'a member' : 'members'}` : ''}</p>
    </div>
  );
}
