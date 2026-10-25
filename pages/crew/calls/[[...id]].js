import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import HeaderNav from '../../../components/HeaderNav';
import MobileTabBar from '../../../components/MobileTabBar';
import Footer from '../../../components/Footer';
import ReportButton from '../../../components/ReportButton';
import PlaceSearch from '../../../components/crew/PlaceSearch';
import TierChip from '../../../components/crew/TierChip';
import { Avatar } from '../../../components/crew/CrewBits';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getOwnCard } from '../../../lib/crewCards';
import { listCalls, getCall } from '../../../lib/crewCalls';
import { getSupabase } from '../../../lib/supabase';
import { ownerProductions } from '../../../lib/productions';
import { CREW_ROLES, CAST_ROLES, UNION_STATUS, WITHIN_CHOICES } from '../../../lib/crewOptions';
import { SelfTapeField, TapePlayer, playingAge } from '../../../components/crew/CastingBits';
import { PAY_TYPES, PAY_HINT, MAX_SPOTS, MAX_ENDORSEMENT_CHARS, URGENT_WITHIN_HOURS, AVAILABLE_NOW_CHOICES } from '../../../lib/crewCallRules';
import { payDollars, crewPayQuote, MIN_CREW_PAY_CENTS, MAX_CREW_PAY_CENTS } from '../../../lib/crewPayRules';
import { getCrewPayCutPercent } from '../../../lib/crewPay';
import { SITE } from '../../../lib/siteConfig';

// The Crew Call board (step 3, mockup signed off 2026-10-10).
//   /crew/calls           the board: filters on the left, calls, one open
//   /crew/calls/<id>      that call open (on a phone: just the call)
//   /crew/calls/new       post a call (?project=pitch:<id> or ?production=<id> preselects)
// Respond = a message to the poster with the call attached. The poster
// books people, and after the last day says who worked it — that is
// where the track record (TierChip) comes from.
const DEFAULT_WITHIN = 50;

export async function getServerSideProps({ req, res, params, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const base = {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    viewerId: account.userId || null
  };
  const slug = params.id && params.id[0] ? String(params.id[0]) : null;

  let own = null;
  if (account.isSignedIn) {
    try { own = await getOwnCard(account.userId); } catch (err) { /* no card */ }
  }
  const near = own && own.place ? { label: own.place.label, lat: own.place.lat, lng: own.place.lng } : null;

  if (slug === 'new') {
    if (!account.isSignedIn) return { props: { ...base, mode: 'new', projects: [], productions: [], preselect: null, preselectProduction: null, near } };
    const supabase = getSupabase();
    const [pitches, series, productions, crewPayCutPercent] = await Promise.all([
      supabase.from('pitches').select('id, title').eq('created_by', account.userId).order('created_at', { ascending: false }).limit(50),
      supabase.from('series').select('id, name').eq('creator_id', account.userId).order('created_at', { ascending: false }).limit(50),
      ownerProductions(account.userId).catch(() => []),
      getCrewPayCutPercent().catch(() => 8)
    ]);
    const projects = [
      ...(pitches.data || []).map((p) => ({ value: `pitch:${p.id}`, label: `Pitch Room · ${p.title}` })),
      ...(series.data || []).map((s) => ({ value: `series:${s.id}`, label: `Series · ${s.name}` }))
    ];
    return { props: { ...base, mode: 'new', projects, productions, preselect: query.project ? String(query.project) : null, preselectProduction: query.production ? String(query.production) : null, near, crewPayCutPercent } };
  }

  let board = { calls: [], total: 0, hasCard: false };
  let active = null;
  let notFound = false;
  try {
    board = await listCalls({ lat: near ? near.lat : undefined, lng: near ? near.lng : undefined, withinMiles: near ? DEFAULT_WITHIN : 0 }, { viewerId: account.userId || null });
    if (slug) {
      try {
        active = await getCall(slug, { viewerId: account.userId || null, isAdmin: account.isAdmin });
      } catch (err) {
        if (err.status === 404 || err.status === 503) notFound = true; else throw err;
      }
    }
  } catch (err) {
    console.error('crew calls page:', err.message);
  }
  return { props: { ...base, mode: 'board', board, active, notFound, near, hasCard: Boolean(own), freeNowUntil: own && own.availableNowUntil ? own.availableNowUntil : null } };
}

const withinLabel = (n) => (n === 0 ? 'Anywhere' : `Within ${n} miles`);
function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!a) return 'Dates to confirm';
  return !b || b === a ? f(a) : `${f(a)}–${f(b)}`;
}
function ago(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return 'just now';
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const payClass = (t) => (t === 'paid' || t === 'union' ? 'paid' : t === 'deferred' ? 'deferred' : 'unpaid');

export default function CrewCallsPage(props) {
  if (props.mode === 'new') return <PostCall {...props} />;
  return <Board {...props} />;
}

function Shell({ title, children, mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber }) {
  return (
    <>
      <Head>
        <title>{title} — Crew Call — {SITE.name}</title>
        <meta name="description" content="Crew calls: who's needed, when, where, how it pays. Post one or respond." />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <main id="main-content" className="stage stage-single crew-page">{children}</main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

function PersonLine({ p, prefix }) {
  return (
    <span className="cc-person">
      <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />
      <span>
        {prefix}<Link href={p.profilePath}>{p.displayName}</Link>
        {p.verified && <span className="crew-ver"> ✓ creator</span>}{' '}
        <TierChip person={p} />
      </span>
    </span>
  );
}

/* ---------------- the board ---------------- */

function Board({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, board: initial, active: initialActive, notFound, near: initialNear, hasCard, freeNowUntil: initialFreeNow }) {
  const router = useRouter();
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [kind, setKind] = useState('');
  const [freeNowUntil, setFreeNowUntil] = useState(initialFreeNow);
  const [freeBusy, setFreeBusy] = useState(false);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [pay, setPay] = useState([]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [matches, setMatches] = useState(false);
  const [near, setNear] = useState(initialNear);
  const [within, setWithin] = useState(initialNear ? DEFAULT_WITHIN : 0);
  const [board, setBoard] = useState(initial);
  const [active, setActive] = useState(initialActive);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const reqId = useRef(0);

  useEffect(() => { setActive(initialActive); }, [initialActive]);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (role) params.set('role', role);
      if (pay.length) params.set('pay', pay.join(','));
      if (remoteOnly) params.set('remote', '1');
      if (matches) params.set('matches', '1');
      if (urgentOnly) params.set('urgent', '1');
      if (kind) params.set('kind', kind);
      if (near) { params.set('lat', String(near.lat)); params.set('lng', String(near.lng)); params.set('within', String(within)); }
      try {
        const res = await fetch(`/api/crew/calls?${params.toString()}`);
        const data = await res.json();
        if (id === reqId.current && res.ok) setBoard(data);
      } catch (err) { /* keep what we have */ } finally { if (id === reqId.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, role, pay, remoteOnly, matches, near, within, urgentOnly, kind]);

  const togglePay = (k) => setPay((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const hasFilters = Boolean(q.trim() || role || pay.length || remoteOnly || matches || urgentOnly || kind);

  // "I'm free right now" (migration 105): a few hours on the card, so
  // urgent calls nearby reach this person first.
  async function setFree(hours) {
    setFreeBusy(true);
    try {
      const res = await fetch('/api/crew/available-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours }) });
      const data = await res.json();
      if (res.ok) setFreeNowUntil(data.availableNowUntil);
    } catch (err) { /* leave as is */ } finally { setFreeBusy(false); }
  }
  const freeNowOn = Boolean(freeNowUntil) && Date.parse(freeNowUntil) > Date.now();

  return (
    <Shell title="Calls" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber}>
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">Connect · Crew Call</span>
          <h1>Calls</h1>
          <p>Who's needed, when, where, how it pays. Anyone with an account can post a call or respond to one; what you've actually done shows next to your name.</p>
        </div>
        {isSignedIn
          ? <Link href="/crew/calls/new" className="crew-btn primary">+ Post a call</Link>
          : <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to post a call</button></SignInButton>}
      </div>
      <div className="crew-subnav" role="tablist">
        <Link href="/crew" className="crew-tab">Find people</Link>
        <Link href="/crew?tab=gear" className="crew-tab">Gear</Link>
        <span className="crew-tab on" aria-current="page">Calls{board.total ? ` · ${board.total}` : ''}</span>
      </div>

      <div className={`crew-find cc-board${active || notFound ? ' has-detail' : ''}`}>
        <aside className="crew-filters">
          <input type="search" className="crew-input" placeholder="Role, title, place, project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" />
          <div className="crew-panel crew-filter-panel">
            <div className="crew-toggle" role="group" aria-label="Kind of call">
              <button type="button" aria-pressed={kind === ''} onClick={() => setKind('')}>All</button>
              <button type="button" aria-pressed={kind === 'crew'} onClick={() => setKind('crew')}>Crew</button>
              <button type="button" aria-pressed={kind === 'cast'} onClick={() => setKind('cast')}>Casting</button>
            </div>
            <label className="crew-field"><span>Role</span>
              <select className="crew-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Any role</option>
                {(kind === 'cast' ? CAST_ROLES : CREW_ROLES).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div className="crew-field"><span>Pay</span>
              <div className="crew-chips crew-filterchips">
                {Object.entries(PAY_TYPES).map(([k, v]) => <button key={k} type="button" aria-pressed={pay.includes(k)} onClick={() => togglePay(k)}>{v}</button>)}
              </div>
            </div>
            <div className="crew-field"><span>Near</span>
              <PlaceSearch value={near} onChange={(p) => { setNear(p); if (p && within === 0) setWithin(DEFAULT_WITHIN); }} placeholder="City, or use your location" compact />
              {near && (
                <select className="crew-select" value={within} onChange={(e) => setWithin(Number(e.target.value))} aria-label="Distance">
                  {WITHIN_CHOICES.map((n) => <option key={n} value={n}>{withinLabel(n)}</option>)}
                </select>
              )}
            </div>
            <div className="crew-chips">
              {hasCard && <button type="button" className={`crew-btn sm${matches ? ' on' : ''}`} aria-pressed={matches} onClick={() => setMatches((v) => !v)}>● Matches my card</button>}
              <button type="button" className={`crew-btn sm${remoteOnly ? ' on' : ''}`} aria-pressed={remoteOnly} onClick={() => setRemoteOnly((v) => !v)}>Remote</button>
              <button type="button" className={`crew-btn sm${urgentOnly ? ' on' : ''}`} aria-pressed={urgentOnly} onClick={() => setUrgentOnly((v) => !v)}>⚡ Urgent{board.urgentCount ? ` · ${board.urgentCount}` : ''}</button>
            </div>
            {hasFilters && <button type="button" className="crew-btn sm ghost" onClick={() => { setQ(''); setRole(''); setPay([]); setRemoteOnly(false); setMatches(false); setUrgentOnly(false); setKind(''); }}>Clear filters</button>}
          </div>
          {hasCard && (
            <div className={`crew-panel crew-freenow${freeNowOn ? ' on' : ''}`}>
              <span className="crew-eyebrow">{freeNowOn ? '● Free right now' : 'Free right now?'}</span>
              {freeNowOn
                ? <p className="crew-muted" style={{ margin: '0.3rem 0 0.5rem' }}>Until <b>{new Date(freeNowUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b> you’re first in line for urgent calls nearby and on top of the directory.</p>
                : <p className="crew-muted" style={{ margin: '0.3rem 0 0.5rem' }}>Someone always bails. Say you can jump in and urgent calls nearby reach you first.</p>}
              <div className="crew-chips">
                {freeNowOn
                  ? <button type="button" className="crew-btn sm" disabled={freeBusy} onClick={() => setFree(0)}>Turn off</button>
                  : AVAILABLE_NOW_CHOICES.map((h) => <button key={h} type="button" className="crew-btn sm" disabled={freeBusy} onClick={() => setFree(h)}>{h} h</button>)}
              </div>
            </div>
          )}
          <div className="crew-panel crew-muted">Calls close themselves a week after the last day. Pay is always labelled — <b>paid, union, deferred, unpaid, other</b>. On a call marked <b>🔒 pay secured</b> the poster has agreed to fund each booked person through {SITE.name}: held until they confirm you worked, then sent to your payout account. Everything else is settled between you.</div>
        </aside>

        <div className="cc-list">
          <div className="crew-rhead">
            <span className="crew-mono">{board.total} open {board.total === 1 ? 'call' : 'calls'}{loading ? ' · updating…' : ''}</span>
            <span className="crew-mono">{near ? `nearest to ${near.label} + remote` : 'newest first'}</span>
          </div>
          {board.calls.length === 0 && (
            <div className="crew-panel crew-empty">
              {hasFilters ? 'No calls match. Clear a filter or widen the distance.' : isSignedIn ? <>No open calls yet. <Link href="/crew/calls/new">Post the first one</Link>.</> : 'No open calls yet. Sign in to post the first one.'}
            </div>
          )}
          {board.calls.map((c) => (
            <Link key={c.id} href={`/crew/calls/${c.id}`} className={`crew-panel cc-call${active && active.call.id === c.id ? ' sel' : ''}`} scroll={false}>
              <div className="cc-title">{c.urgent && <span className="cc-urgent">⚡ Urgent{c.neededLabel ? ` · ${c.neededLabel}` : ''}</span>}{c.kind === 'cast' && <span className="cc-cast">🎭 Casting{c.characterName ? ` · ${c.characterName}` : ''}</span>}{c.title}<span className={`cc-pay ${payClass(c.payType)}`}>{c.payLabel}</span>{c.paySecured && <span className="cc-secured" title={`${payDollars(c.payRateCents)} per person, funded through ${SITE.name} and released when the poster confirms the job`}>🔒 {payDollars(c.payRateCents)} secured</span>}{c.projectTitle && <span className="crew-chip pitch">{c.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · {c.projectTitle}</span>}{c.productionTitle && <span className="crew-chip olive">for {c.productionTitle}</span>}{c.matches && <span className="crew-chip ok">matches your card</span>}{c.mine && <span className="crew-chip pink">yours</span>}</div>
              <div className="cc-when"><span>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''}</span><span>{fmtRange(c.startsOn, c.endsOn)}</span><span>{c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''}</span>{c.payNote && <span>{c.payNote}</span>}</div>
              <div className="cc-owner"><Avatar userId={c.poster.userId} name={c.poster.displayName} src={c.poster.avatarUrl} position={c.poster.avatarPosition} zoom={c.poster.avatarZoom} size="sm" /><span>{c.poster.displayName} <TierChip person={c.poster} /> · {ago(c.createdAt)} · {c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</span></div>
            </Link>
          ))}
        </div>

        <aside className="cc-detail">
          {notFound && <div className="crew-panel crew-empty">That call isn't here any more.<br /><Link href="/crew/calls" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to the board</Link></div>}
          {active && <CallDetail key={active.call.id} data={active} viewerId={viewerId} isSignedIn={isSignedIn} isAdmin={isAdmin} onChange={setActive} />}
          {!active && !notFound && <div className="crew-panel crew-empty cc-pick">Pick a call.</div>}
        </aside>
      </div>
    </Shell>
  );
}

/* ---------------- one call ---------------- */

function CallDetail({ data, viewerId, isSignedIn, isAdmin, onChange }) {
  const router = useRouter();
  const { call, viewerResponse, canRespond, booked, benched = 0, pastEnd, responses, firstResponseMinutes = null, funded = 0, payWarning = null } = data;
  const [reply, setReply] = useState('');
  // Back from Stripe Checkout (pay secured, migration 110): the webhook
  // marks it held a moment later, so re-read the call once.
  const fundedQ = router.query.funded ? String(router.query.funded) : null;
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    if (!fundedQ || fundedQ === 'cancelled' || refreshed) return undefined;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crew/calls/${call.id}`);
        const json = await res.json();
        if (res.ok && json.call) onChange(json);
      } catch (err) { /* keep what we have */ }
      setRefreshed(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [fundedQ, refreshed, call.id, onChange]);
  const [tape, setTape] = useState({ url: '', uid: null });
  const [minor, setMinor] = useState(false);
  const [guardian, setGuardian] = useState({ name: '', contact: '' });
  const [replacing, setReplacing] = useState(false);
  const [shortOnly, setShortOnly] = useState(false);
  const [watching, setWatching] = useState(null); // responseId
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [endorsing, setEndorsing] = useState(null); // responseId
  const [line, setLine] = useState('');
  const isPoster = viewerId && call.poster.userId === viewerId;

  async function api(url, body, method = 'POST') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Something went wrong.');
      return json;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function respond(e) {
    e.preventDefault();
    const r = await api(`/api/crew/calls/${call.id}/respond`, { message: reply, selfTapeUrl: tape.url || null, selfTapeUid: tape.uid || null, minor, guardianName: guardian.name, guardianContact: guardian.contact });
    if (r) { setNote(`Sent to ${call.poster.displayName.split(' ')[0]} — it's in your Messages with the call attached.`); router.replace(`/crew/calls/${call.id}`, undefined, { scroll: false }); }
  }
  async function replaceTape(e) {
    e.preventDefault();
    const r = await api(`/api/crew/calls/${call.id}/respond`, { selfTapeUrl: tape.url || null, selfTapeUid: tape.uid || null }, 'PATCH');
    if (r) { onChange(r); setReplacing(false); setNote('Tape updated — the poster has been told.'); }
  }
  async function shortlist(responseId, body) {
    const r = await api(`/api/crew/calls/${call.id}/shortlist`, { responseId, ...body });
    if (r) onChange(r);
  }
  async function book(responseId, action) {
    const r = await api(`/api/crew/calls/${call.id}/book`, { responseId, action });
    if (r) onChange(r);
  }
  async function fund(responseId) {
    const r = await api(`/api/crew/calls/${call.id}/fund`, { responseId });
    if (r && r.url) window.location.assign(r.url);
  }
  async function outcome(responseId, value) {
    const r = await api(`/api/crew/calls/${call.id}/outcome`, { responseId, outcome: value });
    if (r) { onChange(r); if (value === 'worked') setEndorsing(responseId); }
  }
  async function setStatus(status) {
    const r = await api(`/api/crew/calls/${call.id}`, { status }, 'PATCH');
    if (r) onChange(r);
  }
  async function endorse(e) {
    e.preventDefault();
    const r = await api('/api/crew/endorse', { responseId: endorsing, line, wouldAgain: true });
    if (r) { setEndorsing(null); setLine(''); setNote('Thanks — it shows on their profile.'); router.replace(`/crew/calls/${call.id}`, undefined, { scroll: false }); }
  }

  const spotsLeft = Math.max(0, call.spots - booked);

  return (
    <div className="crew-panel cc-detail-panel">
      <div className="cc-detail-top">
        <Link href="/crew/calls" className="crew-btn sm ghost cc-back" aria-label="Back to the board">‹</Link>
        <span className={`crew-eyebrow${call.urgent ? ' cc-urgent-eye' : ''}`}>{call.urgent ? '⚡ Urgent call' : call.status === 'open' ? 'Open call' : 'Closed'}{call.urgent && call.status !== 'open' ? ' · closed' : ''}{call.urgent && call.neededLabel ? ` · ${call.neededLabel}` : ''}{call.projectTitle ? ` · from a ${call.projectType === 'pitch' ? 'Pitch Room project' : 'series'}` : ''}</span>
      </div>
      <h2 className="cc-h2">{call.title}</h2>
      {call.kind === 'cast' && (
        <div className="cast-block">
          <span className="cc-cast">🎭 Casting</span>
          <div className="cast-block-name">{call.characterName}</div>
          {call.characterDesc && <p className="cc-details">{call.characterDesc}</p>}
          <div className="crew-pmeta">
            {playingAge(call.playingAgeMin, call.playingAgeMax) && <span>{playingAge(call.playingAgeMin, call.playingAgeMax)}</span>}
            {call.unionLabel && <span>{call.unionLabel}</span>}
            {call.minorsOk && <span>Under-18s welcome (with a guardian)</span>}
            {call.selfTapeWanted && <span>Self-tape wanted{call.selfTapeDue ? ` by ${new Date(`${call.selfTapeDue}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>}
            {call.sidesUrl && <a href={call.sidesUrl} target="_blank" rel="noopener noreferrer">Sides ↗</a>}
          </div>
        </div>
      )}
      <div className="cc-kv">
        <span>Role</span><span>{call.role}{call.spots > 1 ? ` · ${call.spots} spots` : ''}{isPoster ? ` · ${booked} booked` : spotsLeft === 0 && call.spots > 0 ? ' · filled' : ''}</span>
        {call.urgent && call.neededBy && <><span>Needed by</span><span><b>{new Date(call.neededBy).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b></span></>}
        <span>When</span><span>{fmtRange(call.startsOn, call.endsOn)}</span>
        <span>Where</span><span>{call.remote ? 'Remote — anyone with the role, anywhere' : call.place}{call.miles != null ? ` · ${call.miles} mi from you` : ''}</span>
        <span>Pay</span><span><span className={`cc-pay ${payClass(call.payType)}`}>{call.payLabel}</span> {call.paySecured && <span className="cc-secured">🔒 {payDollars(call.payRateCents)} per person · secured</span>} {call.payNote}</span>
        {call.paySecured && <><span /><span className="crew-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{isPoster ? `You fund each booked person (${payDollars(call.payRateCents)} + the ${SITE.name} fee + card processing); it's held until you confirm they worked, then sent to their payout account. "Didn't happen" refunds you in full.` : `The poster funds your ${payDollars(call.payRateCents)} through ${SITE.name} once you're booked; it's held until they confirm you worked, then sent to your payout account.`}</span></>}
        {call.projectTitle && <><span>Project</span><span><Link href={call.projectType === 'pitch' ? `/pitches/${call.projectId}` : `/series/${call.projectId}`} className="crew-chip pitch">{call.projectTitle}</Link></span></>}
        {call.productionTitle && <><span>Production</span><span><Link href={`/productions/${call.productionId}`} className="crew-chip olive">{call.productionTitle}</Link> <span className="crew-mono">booked people join its crew list</span></span></>}
        <span>Posted by</span><span><PersonLine p={call.poster} /></span>
      </div>
      {call.details && <p className="cc-details">{call.details}</p>}
      <div className="crew-mono">{call.poster.displayName.split(' ')[0]} has posted {call.poster.posted} {call.poster.posted === 1 ? 'call' : 'calls'} · {call.poster.filled} filled · {call.poster.jobs} confirmed {call.poster.jobs === 1 ? 'job' : 'jobs'} worked{isPoster && firstResponseMinutes ? ` · first response after ${firstResponseMinutes < 60 ? `${firstResponseMinutes} min` : `${Math.round(firstResponseMinutes / 60)} h`}` : ''}</div>

      {note && <div className="crew-status ok" role="status">{note}</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}

      {/* ----- responder side ----- */}
      {!isPoster && call.status === 'open' && !isSignedIn && (
        <div className="crew-actions"><SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to respond</button></SignInButton></div>
      )}
      {!isPoster && canRespond && (
        <form className="cc-form" onSubmit={respond}>
          <label className="crew-field"><span>Respond</span>
            <textarea className="crew-input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={call.kind === 'cast' ? 'A line about you and why this part — your reel and headshots are on your card.' : "Say when you're free, what you bring, and your rate."} maxLength={2000} />
          </label>
          {call.kind === 'cast' && (
            <>
              {call.selfTapeWanted && <SelfTapeField value={tape} onChange={setTape} due={call.selfTapeDue} />}
              {call.minorsOk && (
                <div className="cast-minor">
                  <label className="crew-check"><input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} /><span>The performer is under 18</span></label>
                  {minor && (
                    <div className="crew-row2">
                      <label className="crew-field"><span>Parent / guardian</span><input type="text" className="crew-input" value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} maxLength={80} required /></label>
                      <label className="crew-field"><span>How to reach them</span><input type="text" className="crew-input" value={guardian.contact} onChange={(e) => setGuardian({ ...guardian, contact: e.target.value })} placeholder="phone or email" maxLength={120} required /></label>
                    </div>
                  )}
                  <span className="crew-mono">A minor’s booking goes through the guardian; the poster sees these details, nobody else does.</span>
                </div>
              )}
            </>
          )}
          <div className="crew-actions"><button type="submit" className="crew-btn primary" disabled={busy || reply.trim().length < 2}>Send response</button><span className="crew-mono">goes to {call.poster.displayName.split(' ')[0]}'s inbox with the call attached</span></div>
        </form>
      )}
      {!isPoster && viewerResponse && (
        <div className="cc-form">
          <div className="crew-chips">
            {viewerResponse.status === 'booked' && <span className="crew-chip ok">You're booked</span>}
            {viewerResponse.status === 'backup' && <span className="crew-chip olive">You're on the bench — first in line if someone drops</span>}
            {viewerResponse.status === 'declined' && <span className="crew-chip mute">Not this time</span>}
            {viewerResponse.status === 'sent' && <span className="crew-chip">You responded</span>}
            {viewerResponse.shortlisted && <span className="crew-chip olive">★ Shortlisted</span>}
            {viewerResponse.callbackAt && <span className="crew-chip olive">Callback {new Date(viewerResponse.callbackAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
            {(viewerResponse.selfTapeUrl || viewerResponse.selfTapeUid) && <span className="crew-chip ok">✓ Self-tape attached</span>}
            {viewerResponse.outcome === 'worked' && <span className="crew-chip ok">✓ Confirmed job — on your track record</span>}
            {viewerResponse.pay && viewerResponse.pay.status === 'held' && <span className="crew-chip olive">🔒 {payDollars(viewerResponse.pay.amountCents)} secured for you{viewerResponse.pay.releaseRequestedAt ? ' — waiting on your payout account' : ' — released when the poster confirms you worked'}</span>}
            {viewerResponse.pay && viewerResponse.pay.status === 'released' && <span className="crew-chip ok">💸 {payDollars(viewerResponse.pay.amountCents)} sent to your payout account</span>}
            {viewerResponse.pay && viewerResponse.pay.status === 'refunded' && <span className="crew-chip mute">The secured pay went back to the poster</span>}
            {call.paySecured && viewerResponse.status === 'booked' && !viewerResponse.pay && <span className="crew-chip mute">🔒 {payDollars(call.payRateCents)} secured pay — not funded yet</span>}
          </div>
          {viewerResponse.pay && ['held', 'released'].includes(viewerResponse.pay.status) && viewerResponse.payoutReady === false && (
            <div className="crew-status" role="status">Your pay needs somewhere to go: <Link href="/crew/card">set up payouts on your working card</Link> (a few minutes with Stripe). {SITE.name} sends it the moment your account is ready.</div>
          )}
          {call.kind === 'cast' && call.status === 'open' && (
            replacing
              ? <form className="cc-form" onSubmit={replaceTape}><SelfTapeField value={tape} onChange={setTape} due={call.selfTapeDue} /><div className="crew-actions"><button type="submit" className="crew-btn sm primary" disabled={busy || (!tape.url && !tape.uid)}>Save tape</button><button type="button" className="crew-btn sm ghost" onClick={() => setReplacing(false)}>Cancel</button></div></form>
              : <div><button type="button" className="crew-btn sm" onClick={() => { setTape({ url: viewerResponse.selfTapeUrl || '', uid: null }); setReplacing(true); }}>{viewerResponse.selfTapeUrl || viewerResponse.selfTapeUid ? 'Replace self-tape' : 'Add a self-tape'}</button></div>
          )}
          <div className="crew-actions">
            {viewerResponse.threadId && <Link href={`/messages/${viewerResponse.threadId}`} className="crew-btn sm">Open the conversation</Link>}
            {viewerResponse.outcome === 'worked' && !viewerResponse.endorsed && !endorsing && <button type="button" className="crew-btn sm primary" onClick={() => setEndorsing(viewerResponse.id)}>Leave {call.poster.displayName.split(' ')[0]} a line</button>}
          </div>
        </div>
      )}
      {!isPoster && isSignedIn && !canRespond && !viewerResponse && call.status === 'open' && (
        <div className="crew-mono">You can't respond to this call.</div>
      )}

      {/* ----- poster side ----- */}
      {isPoster && (
        <div className="cc-form">
          <div className="crew-actions">
            {call.status === 'open'
              ? <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setStatus('closed')}>Close the call</button>
              : <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setStatus('open')}>Reopen</button>}
            <span className="crew-mono">{booked} of {call.spots} {call.spots === 1 ? 'spot' : 'spots'} booked{benched ? ` · ${benched} on the bench` : ''}{call.paySecured ? ` · ${funded} of ${booked} funded` : ''}{call.status === 'open' ? ' · closing tells the others' : ''}</span>
          </div>
          {fundedQ && fundedQ !== 'cancelled' && <div className="crew-status ok" role="status">Payment received — it’s held until you confirm the job{refreshed ? '' : '…'}</div>}
          {fundedQ === 'cancelled' && <div className="crew-status" role="status">No charge was made. Fund them whenever you’re ready.</div>}
          {payWarning && <div className="crew-status error" role="alert">{payWarning}</div>}
          <div className="crew-rhead"><h4 className="cc-h4">Responses{responses && responses.length ? ` · ${responses.length}` : ''}{call.kind === 'cast' && data.shortlisted ? ` · ${data.shortlisted} shortlisted` : ''}</h4>{call.kind === 'cast' && responses && responses.length > 0 && <button type="button" className={`crew-btn sm${shortOnly ? ' on' : ''}`} aria-pressed={shortOnly} onClick={() => setShortOnly((v) => !v)}>★ Shortlisted only</button>}</div>
          {(!responses || responses.length === 0) && <div className="crew-muted">No responses yet. Matching people were told when you posted.</div>}
          {responses && responses.filter((r) => !shortOnly || r.shortlisted).map((r) => (
            <div key={r.id} className={`cc-resp${r.status === 'booked' || r.outcome === 'worked' ? ' booked' : ''}${r.shortlisted ? ' shortlisted' : ''}`}>
              <Avatar userId={r.person.userId} name={r.person.displayName} src={r.person.avatarUrl} position={r.person.avatarPosition} zoom={r.person.avatarZoom} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className="crew-pname"><Link href={r.person.profilePath}>{r.person.displayName}</Link>{r.person.verified && <span className="crew-ver">✓ creator</span>}<TierChip person={r.person} /></div>
                <div className="crew-mono">{r.person.jobs} confirmed {r.person.jobs === 1 ? 'job' : 'jobs'} on Crew Call · {r.person.titles} released {r.person.titles === 1 ? 'title' : 'titles'}{r.person.wouldAgain ? ` · ${r.person.wouldAgain} would work again` : ''}{r.person.cameThrough ? ` · came through on ${r.person.cameThrough} urgent ${r.person.cameThrough === 1 ? 'call' : 'calls'}` : ''}{r.person.noShows ? ` · ${r.person.noShows} no-show${r.person.noShows === 1 ? '' : 's'}` : ''}</div>
                <p className="cc-resp-msg">“{r.message}”</p>
                {call.kind === 'cast' && (
                  <div className="cast-resp">
                    <div className="crew-chips">
                      {r.shortlisted && <span className="crew-chip olive">★ Shortlisted</span>}
                      {r.callbackAt && <span className="crew-chip olive">Callback {new Date(r.callbackAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                      {r.minor && <span className="crew-chip warn">Under 18 · guardian: {r.guardianName} ({r.guardianContact})</span>}
                      {r.selfTapeUrl && <a href={r.selfTapeUrl} target="_blank" rel="noopener noreferrer" className="crew-chip ok">▶ Self-tape link ↗</a>}
                      {r.selfTapeUid && <button type="button" className="crew-chip ok" style={{ cursor: 'pointer', border: 0 }} onClick={() => setWatching(watching === r.id ? null : r.id)}>{watching === r.id ? 'Hide tape' : '▶ Watch self-tape'}</button>}
                      {!r.selfTapeUrl && !r.selfTapeUid && call.selfTapeWanted && <span className="crew-chip mute">no tape yet</span>}
                    </div>
                    {watching === r.id && r.selfTapeUid && <TapePlayer callId={call.id} responseId={r.id} />}
                    {!r.outcome && (
                      <div className="crew-actions">
                        <button type="button" className={`crew-btn sm${r.shortlisted ? ' on' : ''}`} disabled={busy} onClick={() => shortlist(r.id, { shortlisted: !r.shortlisted })}>{r.shortlisted ? '★ Shortlisted' : '☆ Shortlist'}</button>
                        <label className="crew-mono" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>Callback <input type="datetime-local" className="crew-input" style={{ width: 'auto', padding: '0.25rem 0.4rem', fontSize: '0.78rem' }} defaultValue={r.callbackAt ? new Date(r.callbackAt).toISOString().slice(0, 16) : ''} onBlur={(e) => { const v = e.target.value; if ((v && new Date(v).toISOString() !== r.callbackAt) || (!v && r.callbackAt)) shortlist(r.id, { callbackAt: v ? new Date(v).toISOString() : null }); }} /></label>
                      </div>
                    )}
                  </div>
                )}
                <div className="crew-chips">
                  {r.status === 'booked' && !r.outcome && <span className="crew-chip ok">Booked</span>}
                  {r.status === 'backup' && <span className="crew-chip olive">On the bench</span>}
                  {r.status === 'declined' && <span className="crew-chip mute">Declined</span>}
                  {r.outcome === 'worked' && <span className="crew-chip ok">✓ Worked it</span>}
                  {r.outcome === 'no_show' && <span className="crew-chip warn">Didn't happen</span>}
                  {r.outcome === 'cancelled' && <span className="crew-chip mute">Cancelled</span>}
                  {r.pay && r.pay.status === 'held' && <span className="crew-chip olive" title={`You paid ${payDollars(r.pay.totalCents)} (${payDollars(r.pay.cutCents)} ${SITE.name} fee + ${payDollars(r.pay.feeCents)} card processing)`}>🔒 {payDollars(r.pay.amountCents)} held{r.pay.releaseRequestedAt ? ' · waiting on their payout account' : ' · released when you confirm'}</span>}
                  {r.pay && r.pay.status === 'released' && <span className="crew-chip ok">💸 {payDollars(r.pay.amountCents)} paid out</span>}
                  {r.pay && r.pay.status === 'refunded' && <span className="crew-chip mute">↩ {payDollars(r.pay.refundedCents == null ? r.pay.totalCents : r.pay.refundedCents)} refunded to you</span>}
                  {r.pay && r.pay.status === 'pending_payment' && <span className="crew-chip warn">Payment not finished</span>}
                </div>
                {r.status === 'booked' && !r.outcome && pastEnd && (
                  <div className="cc-outcome">
                    <span className="crew-mono">Did they work the job?</span>
                    <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => outcome(r.id, 'worked')}>Yes, worked it</button>
                    <button type="button" className="crew-btn sm" disabled={busy} onClick={() => outcome(r.id, 'no_show')}>Didn't happen</button>
                  </div>
                )}
                {endorsing === r.id && (
                  <form className="cc-endorse" onSubmit={endorse}>
                    <input type="text" className="crew-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={MAX_ENDORSEMENT_CHARS} placeholder={`One line about working with ${r.person.displayName.split(' ')[0]}`} />
                    <button type="submit" className="crew-btn sm primary" disabled={busy || !line.trim()}>Post it</button>
                    <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(null)}>Skip</button>
                  </form>
                )}
                {r.outcome === 'worked' && !r.endorsedByPoster && endorsing !== r.id && <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(r.id)}>Leave a line</button>}
              </div>
              <div className="cc-resp-acts">
                {r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm">Message</Link>}
                {r.status === 'sent' && call.status === 'open' && <button type="button" className="crew-btn sm primary" disabled={busy || spotsLeft === 0} onClick={() => book(r.id, 'book')}>{spotsLeft === 0 ? 'Full' : 'Book'}</button>}
                {r.status === 'sent' && call.status === 'open' && <button type="button" className="crew-btn sm" disabled={busy} title="Backup for the spot — first in line if the booked person drops" onClick={() => book(r.id, 'bench')}>Bench</button>}
                {r.status === 'sent' && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => book(r.id, 'decline')}>Decline</button>}
                {r.status === 'backup' && <button type="button" className="crew-btn sm primary" disabled={busy || spotsLeft === 0} onClick={() => book(r.id, 'promote')}>{spotsLeft === 0 ? 'Spots full' : 'Promote'}</button>}
                {r.status === 'backup' && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => book(r.id, 'unbench')}>Off the bench</button>}
                {call.paySecured && r.status === 'booked' && (!r.outcome || r.outcome === 'worked') && (!r.pay || !['held', 'released'].includes(r.pay.status)) && <button type="button" className="crew-btn sm primary" disabled={busy} title={`${payDollars(call.payRateCents)} to them + ${SITE.name} fee + card processing, held until you confirm the job`} onClick={() => fund(r.id)}>{r.pay && r.pay.status === 'pending_payment' ? 'Finish paying' : `🔒 Fund ${payDollars(call.payRateCents)}`}</button>}
                {r.status === 'booked' && !r.outcome && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => book(r.id, 'unbook')}>Unbook</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* responder's endorsement form */}
      {!isPoster && endorsing && (
        <form className="cc-endorse" onSubmit={endorse}>
          <input type="text" className="crew-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={MAX_ENDORSEMENT_CHARS} placeholder={`One line about working with ${call.poster.displayName.split(' ')[0]}`} />
          <button type="submit" className="crew-btn sm primary" disabled={busy || !line.trim()}>Post it</button>
          <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(null)}>Skip</button>
        </form>
      )}

      <div className="crew-actions cc-foot">
        {!isPoster && isSignedIn && <ReportButton targetType="call" targetId={call.id} title={call.title} className="crew-mono" />}
        {isAdmin && !isPoster && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this call from the board?')) setStatus('removed').then(() => router.push('/crew/calls')); }}>Remove (admin)</button>}
      </div>
    </div>
  );
}

/* ---------------- post a call ---------------- */

function PostCall({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, projects, productions = [], preselect, preselectProduction, near, crewPayCutPercent = 8 }) {
  const router = useRouter();
  const [form, setForm] = useState({ kind: 'crew', characterName: '', characterDesc: '', playingAgeMin: '', playingAgeMax: '', unionStatus: '', sidesUrl: '', selfTapeWanted: true, selfTapeDue: '', minorsOk: false, title: '', role: CREW_ROLES[0], spots: 1, payType: 'paid', payNote: '', paySecured: false, payRateDollars: '', startsOn: '', endsOn: '', remote: false, urgent: false, neededBy: '', place: near ? { label: near.label, lat: near.lat, lng: near.lng } : null, project: preselect || '', production: preselectProduction && productions.some((p) => p.value === preselectProduction) ? preselectProduction : '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [type, id] = form.project ? form.project.split(':') : [null, null];
      const body = { ...form, project: type ? { type, id } : null, production: form.production || null, neededBy: form.urgent && form.neededBy ? new Date(form.neededBy).toISOString() : null };
      const res = await fetch('/api/crew/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post that.');
      router.push(`/crew/calls/${data.call.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Post a call" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber}>
      <div className="crew-crumbs"><Link href="/crew">Crew Call</Link><span>/</span><Link href="/crew/calls">Calls</Link><span>/</span><span>Post a call</span></div>
      {!isSignedIn ? (
        <div className="crew-panel crew-signin">
          <span className="crew-eyebrow">Crew Call</span>
          <h1>Post a call</h1>
          <p>Say who you need, when, where and how it pays. Everyone whose working card matches gets told.</p>
          <SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in or create an account</button></SignInButton>
        </div>
      ) : (
        <div className="crew-card-grid">
          <form className="crew-panel cc-postform" onSubmit={submit}>
            <span className="crew-eyebrow">Post a call</span>
            <div className="crew-toggle" role="group" aria-label="Kind of call">
              <button type="button" aria-pressed={form.kind === 'crew'} onClick={() => set({ kind: 'crew', role: CREW_ROLES.includes(form.role) && !CAST_ROLES.includes(form.role) ? form.role : CREW_ROLES[0] })}>Crew call</button>
              <button type="button" aria-pressed={form.kind === 'cast'} onClick={() => set({ kind: 'cast', role: CAST_ROLES.includes(form.role) ? form.role : CAST_ROLES[0] })}>🎭 Casting call</button>
            </div>
            {form.kind === 'cast' && (
              <div className="cast-block edit">
                <label className="crew-field"><span>Character</span><input type="text" className="crew-input" value={form.characterName} onChange={(e) => set({ characterName: e.target.value })} placeholder="MARTA, the night-shift nurse — or “Background, diner”" maxLength={60} required /></label>
                <label className="crew-field"><span>Who they are</span><textarea className="crew-input" rows={3} value={form.characterDesc} onChange={(e) => set({ characterDesc: e.target.value })} placeholder="A line or three on the character and what you’re looking for." maxLength={1000} /></label>
                <div className="crew-row2">
                  <div className="crew-field"><span>Playing age</span><div className="crew-row2"><input type="number" className="crew-input" min="0" max="110" placeholder="from" value={form.playingAgeMin} onChange={(e) => set({ playingAgeMin: e.target.value })} aria-label="Playing age from" /><input type="number" className="crew-input" min="0" max="110" placeholder="to" value={form.playingAgeMax} onChange={(e) => set({ playingAgeMax: e.target.value })} aria-label="Playing age to" /></div></div>
                  <label className="crew-field"><span>Union</span><select className="crew-select" value={form.unionStatus} onChange={(e) => set({ unionStatus: e.target.value })}><option value="">Either / not specified</option>{Object.entries(UNION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                </div>
                <label className="crew-field"><span>Sides (optional)</span><input type="url" className="crew-input" value={form.sidesUrl} onChange={(e) => set({ sidesUrl: e.target.value })} placeholder="https:// link to the pages" /></label>
                <div className="crew-row2">
                  <label className="crew-check"><input type="checkbox" checked={form.selfTapeWanted} onChange={(e) => set({ selfTapeWanted: e.target.checked })} /><span>Ask for a self-tape</span></label>
                  {form.selfTapeWanted && <label className="crew-field"><span>Tape due</span><input type="date" className="crew-input" value={form.selfTapeDue} onChange={(e) => set({ selfTapeDue: e.target.value })} /></label>}
                </div>
                <label className="crew-check"><input type="checkbox" checked={form.minorsOk} onChange={(e) => set({ minorsOk: e.target.checked })} /><span>Performers under 18 may apply <small className="crew-mono">(a parent or guardian’s name and contact is required on their response)</small></span></label>
              </div>
            )}
            <div className={`cc-urgentbox${form.urgent ? ' on' : ''}`}>
              <label className="crew-check"><input type="checkbox" checked={form.urgent} onChange={(e) => set({ urgent: e.target.checked })} /><span><b>⚡ This is urgent — someone dropped.</b> Needed within {URGENT_WITHIN_HOURS} hours. It goes to the top of the board, people who said they’re free right now hear first, and it closes itself once the time passes.</span></label>
              {form.urgent && (
                <label className="crew-field"><span>Needed by</span><input type="datetime-local" className="crew-input" value={form.neededBy} onChange={(e) => set({ neededBy: e.target.value })} min={new Date(Date.now() + 15 * 60000).toISOString().slice(0, 16)} max={new Date(Date.now() + URGENT_WITHIN_HOURS * 3600000).toISOString().slice(0, 16)} required /></label>
              )}
            </div>
            <label className="crew-field"><span>Title</span><input type="text" className="crew-input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={form.kind === 'cast' ? 'Lead for a 12-minute short, two days in Echo Park' : 'Gaffer for two nights'} maxLength={80} required /></label>
            <div className="crew-row2">
              <label className="crew-field"><span>{form.kind === 'cast' ? 'Performer type' : 'Role needed'}</span>
                <select className="crew-select" value={form.role} onChange={(e) => set({ role: e.target.value })}>{(form.kind === 'cast' ? CAST_ROLES : CREW_ROLES).map((r) => <option key={r} value={r}>{r}</option>)}</select>
              </label>
              <label className="crew-field"><span>Spots</span><input type="number" className="crew-input" min="1" max={MAX_SPOTS} value={form.spots} onChange={(e) => set({ spots: e.target.value })} /></label>
            </div>
            <div className="crew-row2">
              <label className="crew-field"><span>Pay</span>
                <select className="crew-select" value={form.payType} onChange={(e) => set({ payType: e.target.value })}>{Object.entries(PAY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="crew-field"><span>Pay details</span><input type="text" className="crew-input" value={form.payNote} onChange={(e) => set({ payNote: e.target.value })} placeholder={PAY_HINT[form.payType]} maxLength={120} /></label>
            </div>
            {form.payType === 'paid' && (
              <div className={`cc-securebox${form.paySecured ? ' on' : ''}`}>
                <label className="crew-check">
                  <input type="checkbox" checked={form.paySecured} onChange={(e) => set({ paySecured: e.target.checked })} />
                  <span><b>🔒 Secure the pay through {SITE.name}</b> — you fund each person after you book them; it’s held and sent to them when you confirm they worked.</span>
                </label>
                {form.paySecured && (() => {
                  const cents = Math.round(Number(String(form.payRateDollars).replace(/[$,\s]/g, '')) * 100);
                  const q = Number.isFinite(cents) && cents > 0 ? crewPayQuote(cents, crewPayCutPercent) : null;
                  return (
                    <>
                      <label className="crew-field"><span>Rate per person, for the whole job (dollars)</span><input type="number" className="crew-input" min={MIN_CREW_PAY_CENTS / 100} max={MAX_CREW_PAY_CENTS / 100} step="1" value={form.payRateDollars} onChange={(e) => set({ payRateDollars: e.target.value })} placeholder="350" required /></label>
                      <span className="crew-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
                        {q ? <>Each person you fund costs you <b>{payDollars(q.totalCents)}</b>: {payDollars(q.amountCents)} to them + {payDollars(q.cutCents)} {SITE.name} fee ({crewPayCutPercent}%) + {payDollars(q.feeCents)} card processing. They get the full {payDollars(q.amountCents)}. Nothing is charged until you fund someone.</> : <>From {payDollars(MIN_CREW_PAY_CENTS)} per person. The {SITE.name} fee ({crewPayCutPercent}%) and card processing are added on top, so they get the full rate. Nothing is charged until you fund someone.</>}
                        {' '}“Didn’t happen” refunds you in full; unbooking someone you funded refunds everything but the card fee.
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="crew-row2">
              <label className="crew-field"><span>First day</span><input type="date" className="crew-input" value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></label>
              <label className="crew-field"><span>Last day</span><input type="date" className="crew-input" value={form.endsOn} onChange={(e) => set({ endsOn: e.target.value })} min={form.startsOn || undefined} /></label>
            </div>
            <div className="crew-field"><span>Where</span>
              {!form.remote && <PlaceSearch value={form.place} onChange={(p) => set({ place: p })} placeholder="City (pick from the suggestions)" />}
              <label className="crew-check"><input type="checkbox" checked={form.remote} onChange={(e) => set({ remote: e.target.checked })} /><span>Remote — anyone with the role, anywhere</span></label>
            </div>
            <label className="crew-field"><span>Project (optional)</span>
              <select className="crew-select" value={form.project} onChange={(e) => set({ project: e.target.value })}>
                <option value="">Independent — no project page</option>
                {projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="crew-field"><span>Production (optional)</span>
              <select className="crew-select" value={form.production} onChange={(e) => set({ production: e.target.value })}>
                <option value="">None — just this call</option>
                {productions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <span className="crew-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>Booked people join the production’s crew list; “worked it” becomes their credit when it’s released. <Link href="/productions/new">Start a production</Link>.</span>
            </label>
            <label className="crew-field"><span>Details</span><textarea className="crew-input" rows={6} value={form.details} onChange={(e) => set({ details: e.target.value })} placeholder="What the days look like, what you have already, what they should bring." maxLength={2000} /></label>
            {error && <div className="crew-status error" role="alert">{error}</div>}
            <div className="crew-actions"><button type="submit" className="crew-btn primary" disabled={busy}>{busy ? 'Posting…' : 'Post the call'}</button><Link href="/crew/calls" className="crew-btn ghost">Cancel</Link></div>
          </form>
          <aside className="crew-aside">
            <div className="crew-panel crew-wc-side">
              <h3>Who hears about it</h3>
              <p className="crew-muted" style={{ margin: 0 }}>Everyone whose working card lists <b>{form.role}</b>{form.kind === 'cast' && (form.playingAgeMin || form.playingAgeMax) ? ' (and whose playing age overlaps yours)' : ''} and whose place + travel radius reaches {form.remote ? 'anywhere (remote call)' : form.place ? form.place.label : 'the place you pick'} gets a notification and an email. People can switch call emails off on their card.</p>
            </div>
            <div className="crew-panel crew-wc-side">
              <h3>Rules</h3>
              <ul className="cc-rules">
                <li>Pay is labelled — paid, union, deferred, unpaid, other. No money moves through the site.</li>
                <li>Responses land in your Messages with the call attached. Book from the call page.</li>
                <li>After the last day you'll be asked who worked it — that's what builds people's track record.</li>
                <li>Calls close a week after the last day. Up to 10 open at a time.</li>
                <li>Urgent calls (someone dropped, needed within {URGENT_WITHIN_HOURS} hours) sit at the top and close when the time passes. Bench a backup so a drop doesn’t sink the day.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
