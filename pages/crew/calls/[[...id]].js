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
import { CREW_ROLES, WITHIN_CHOICES } from '../../../lib/crewOptions';
import { PAY_TYPES, PAY_HINT, MAX_SPOTS, MAX_ENDORSEMENT_CHARS } from '../../../lib/crewCallRules';
import { SITE } from '../../../lib/siteConfig';

// The Crew Call board (step 3, mockup signed off 2026-10-10).
//   /crew/calls           the board: filters on the left, calls, one open
//   /crew/calls/<id>      that call open (on a phone: just the call)
//   /crew/calls/new       post a call (?project=pitch:<id> preselects)
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
    if (!account.isSignedIn) return { props: { ...base, mode: 'new', projects: [], preselect: null, near } };
    const supabase = getSupabase();
    const [pitches, series] = await Promise.all([
      supabase.from('pitches').select('id, title').eq('created_by', account.userId).order('created_at', { ascending: false }).limit(50),
      supabase.from('series').select('id, name').eq('creator_id', account.userId).order('created_at', { ascending: false }).limit(50)
    ]);
    const projects = [
      ...(pitches.data || []).map((p) => ({ value: `pitch:${p.id}`, label: `Pitch Room · ${p.title}` })),
      ...(series.data || []).map((s) => ({ value: `series:${s.id}`, label: `Series · ${s.name}` }))
    ];
    return { props: { ...base, mode: 'new', projects, preselect: query.project ? String(query.project) : null, near } };
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
  return { props: { ...base, mode: 'board', board, active, notFound, near, hasCard: Boolean(own) } };
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
    <span className="cl-person">
      <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} size="sm" />
      <span>
        {prefix}<Link href={p.profilePath}>{p.displayName}</Link>
        {p.verified && <span className="crew-ver"> ✓ creator</span>}{' '}
        <TierChip person={p} />
      </span>
    </span>
  );
}

/* ---------------- the board ---------------- */

function Board({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, board: initial, active: initialActive, notFound, near: initialNear, hasCard }) {
  const router = useRouter();
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
      if (near) { params.set('lat', String(near.lat)); params.set('lng', String(near.lng)); params.set('within', String(within)); }
      try {
        const res = await fetch(`/api/crew/calls?${params.toString()}`);
        const data = await res.json();
        if (id === reqId.current && res.ok) setBoard(data);
      } catch (err) { /* keep what we have */ } finally { if (id === reqId.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, role, pay, remoteOnly, matches, near, within]);

  const togglePay = (k) => setPay((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const hasFilters = Boolean(q.trim() || role || pay.length || remoteOnly || matches);

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

      <div className={`crew-find cl-board${active || notFound ? ' has-detail' : ''}`}>
        <aside className="crew-filters">
          <input type="search" className="crew-input" placeholder="Role, title, place, project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" />
          <div className="crew-panel crew-filter-panel">
            <label className="crew-field"><span>Role</span>
              <select className="crew-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Any role</option>
                {CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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
            </div>
            {hasFilters && <button type="button" className="crew-btn sm ghost" onClick={() => { setQ(''); setRole(''); setPay([]); setRemoteOnly(false); setMatches(false); }}>Clear filters</button>}
          </div>
          <div className="crew-panel crew-muted">Calls close themselves a week after the last day. Pay is always labelled — <b>paid, union, deferred, unpaid, other</b> — and no money moves through the site.</div>
        </aside>

        <div className="cl-list">
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
            <Link key={c.id} href={`/crew/calls/${c.id}`} className={`crew-panel cl-call${active && active.call.id === c.id ? ' sel' : ''}`} scroll={false}>
              <div className="cl-title">{c.title}<span className={`cl-pay ${payClass(c.payType)}`}>{c.payLabel}</span>{c.projectTitle && <span className="crew-chip pitch">{c.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · {c.projectTitle}</span>}{c.matches && <span className="crew-chip ok">matches your card</span>}{c.mine && <span className="crew-chip pink">yours</span>}</div>
              <div className="cl-when"><span>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''}</span><span>{fmtRange(c.startsOn, c.endsOn)}</span><span>{c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''}</span>{c.payNote && <span>{c.payNote}</span>}</div>
              <div className="cl-owner"><Avatar userId={c.poster.userId} name={c.poster.displayName} src={c.poster.avatarUrl} size="sm" /><span>{c.poster.displayName} <TierChip person={c.poster} /> · {ago(c.createdAt)} · {c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</span></div>
            </Link>
          ))}
        </div>

        <aside className="cl-detail">
          {notFound && <div className="crew-panel crew-empty">That call isn't here any more.<br /><Link href="/crew/calls" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to the board</Link></div>}
          {active && <CallDetail key={active.call.id} data={active} viewerId={viewerId} isSignedIn={isSignedIn} isAdmin={isAdmin} onChange={setActive} />}
          {!active && !notFound && <div className="crew-panel crew-empty cl-pick">Pick a call.</div>}
        </aside>
      </div>
    </Shell>
  );
}

/* ---------------- one call ---------------- */

function CallDetail({ data, viewerId, isSignedIn, isAdmin, onChange }) {
  const router = useRouter();
  const { call, viewerResponse, canRespond, booked, pastEnd, responses } = data;
  const [reply, setReply] = useState('');
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
    const r = await api(`/api/crew/calls/${call.id}/respond`, { message: reply });
    if (r) { setNote(`Sent to ${call.poster.displayName.split(' ')[0]} — it's in your Messages with the call attached.`); router.replace(`/crew/calls/${call.id}`, undefined, { scroll: false }); }
  }
  async function book(responseId, action) {
    const r = await api(`/api/crew/calls/${call.id}/book`, { responseId, action });
    if (r) onChange(r);
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
    <div className="crew-panel cl-detail-panel">
      <div className="cl-detail-top">
        <Link href="/crew/calls" className="crew-btn sm ghost cl-back" aria-label="Back to the board">‹</Link>
        <span className="crew-eyebrow">{call.status === 'open' ? 'Open call' : 'Closed'}{call.projectTitle ? ` · from a ${call.projectType === 'pitch' ? 'Pitch Room project' : 'series'}` : ''}</span>
      </div>
      <h2 className="cl-h2">{call.title}</h2>
      <div className="cl-kv">
        <span>Role</span><span>{call.role}{call.spots > 1 ? ` · ${call.spots} spots` : ''}{isPoster ? ` · ${booked} booked` : spotsLeft === 0 && call.spots > 0 ? ' · filled' : ''}</span>
        <span>When</span><span>{fmtRange(call.startsOn, call.endsOn)}</span>
        <span>Where</span><span>{call.remote ? 'Remote — anyone with the role, anywhere' : call.place}{call.miles != null ? ` · ${call.miles} mi from you` : ''}</span>
        <span>Pay</span><span><span className={`cl-pay ${payClass(call.payType)}`}>{call.payLabel}</span> {call.payNote}</span>
        {call.projectTitle && <><span>Project</span><span><Link href={call.projectType === 'pitch' ? `/pitches/${call.projectId}` : `/series/${call.projectId}`} className="crew-chip pitch">{call.projectTitle}</Link></span></>}
        <span>Posted by</span><span><PersonLine p={call.poster} /></span>
      </div>
      {call.details && <p className="cl-details">{call.details}</p>}
      <div className="crew-mono">{call.poster.displayName.split(' ')[0]} has posted {call.poster.posted} {call.poster.posted === 1 ? 'call' : 'calls'} · {call.poster.filled} filled · {call.poster.jobs} confirmed {call.poster.jobs === 1 ? 'job' : 'jobs'} worked</div>

      {note && <div className="crew-status ok" role="status">{note}</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}

      {/* ----- responder side ----- */}
      {!isPoster && call.status === 'open' && !isSignedIn && (
        <div className="crew-actions"><SignInButton mode="modal"><button type="button" className="crew-btn primary">Sign in to respond</button></SignInButton></div>
      )}
      {!isPoster && canRespond && (
        <form className="cl-form" onSubmit={respond}>
          <label className="crew-field"><span>Respond</span>
            <textarea className="crew-input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Say when you're free, what you bring, and your rate." maxLength={2000} />
          </label>
          <div className="crew-actions"><button type="submit" className="crew-btn primary" disabled={busy || reply.trim().length < 2}>Send response</button><span className="crew-mono">goes to {call.poster.displayName.split(' ')[0]}'s inbox with the call attached</span></div>
        </form>
      )}
      {!isPoster && viewerResponse && (
        <div className="cl-form">
          <div className="crew-chips">
            {viewerResponse.status === 'booked' && <span className="crew-chip ok">You're booked</span>}
            {viewerResponse.status === 'declined' && <span className="crew-chip mute">Not this time</span>}
            {viewerResponse.status === 'sent' && <span className="crew-chip">You responded</span>}
            {viewerResponse.outcome === 'worked' && <span className="crew-chip ok">✓ Confirmed job — on your track record</span>}
          </div>
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
        <div className="cl-form">
          <div className="crew-actions">
            {call.status === 'open'
              ? <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setStatus('closed')}>Close the call</button>
              : <button type="button" className="crew-btn sm" disabled={busy} onClick={() => setStatus('open')}>Reopen</button>}
            <span className="crew-mono">{booked} of {call.spots} {call.spots === 1 ? 'spot' : 'spots'} booked{call.status === 'open' ? ' · closing tells the others' : ''}</span>
          </div>
          <h4 className="cl-h4">Responses{responses && responses.length ? ` · ${responses.length}` : ''}</h4>
          {(!responses || responses.length === 0) && <div className="crew-muted">No responses yet. Matching people were told when you posted.</div>}
          {responses && responses.map((r) => (
            <div key={r.id} className={`cl-resp${r.status === 'booked' || r.outcome === 'worked' ? ' booked' : ''}`}>
              <Avatar userId={r.person.userId} name={r.person.displayName} src={r.person.avatarUrl} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className="crew-pname"><Link href={r.person.profilePath}>{r.person.displayName}</Link>{r.person.verified && <span className="crew-ver">✓ creator</span>}<TierChip person={r.person} /></div>
                <div className="crew-mono">{r.person.jobs} confirmed {r.person.jobs === 1 ? 'job' : 'jobs'} on Crew Call · {r.person.titles} released {r.person.titles === 1 ? 'title' : 'titles'}{r.person.wouldAgain ? ` · ${r.person.wouldAgain} would work again` : ''}</div>
                <p className="cl-resp-msg">“{r.message}”</p>
                <div className="crew-chips">
                  {r.status === 'booked' && !r.outcome && <span className="crew-chip ok">Booked</span>}
                  {r.status === 'declined' && <span className="crew-chip mute">Declined</span>}
                  {r.outcome === 'worked' && <span className="crew-chip ok">✓ Worked it</span>}
                  {r.outcome === 'no_show' && <span className="crew-chip warn">Didn't happen</span>}
                  {r.outcome === 'cancelled' && <span className="crew-chip mute">Cancelled</span>}
                </div>
                {r.status === 'booked' && !r.outcome && pastEnd && (
                  <div className="cl-outcome">
                    <span className="crew-mono">Did they work the job?</span>
                    <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => outcome(r.id, 'worked')}>Yes, worked it</button>
                    <button type="button" className="crew-btn sm" disabled={busy} onClick={() => outcome(r.id, 'no_show')}>Didn't happen</button>
                  </div>
                )}
                {endorsing === r.id && (
                  <form className="cl-endorse" onSubmit={endorse}>
                    <input type="text" className="crew-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={MAX_ENDORSEMENT_CHARS} placeholder={`One line about working with ${r.person.displayName.split(' ')[0]}`} />
                    <button type="submit" className="crew-btn sm primary" disabled={busy || !line.trim()}>Post it</button>
                    <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(null)}>Skip</button>
                  </form>
                )}
                {r.outcome === 'worked' && !r.endorsedByPoster && endorsing !== r.id && <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(r.id)}>Leave a line</button>}
              </div>
              <div className="cl-resp-acts">
                {r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm">Message</Link>}
                {r.status === 'sent' && call.status === 'open' && <button type="button" className="crew-btn sm primary" disabled={busy || spotsLeft === 0} onClick={() => book(r.id, 'book')}>{spotsLeft === 0 ? 'Full' : 'Book'}</button>}
                {r.status === 'sent' && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => book(r.id, 'decline')}>Decline</button>}
                {r.status === 'booked' && !r.outcome && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => book(r.id, 'unbook')}>Unbook</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* responder's endorsement form */}
      {!isPoster && endorsing && (
        <form className="cl-endorse" onSubmit={endorse}>
          <input type="text" className="crew-input" value={line} onChange={(e) => setLine(e.target.value)} maxLength={MAX_ENDORSEMENT_CHARS} placeholder={`One line about working with ${call.poster.displayName.split(' ')[0]}`} />
          <button type="submit" className="crew-btn sm primary" disabled={busy || !line.trim()}>Post it</button>
          <button type="button" className="crew-btn sm ghost" onClick={() => setEndorsing(null)}>Skip</button>
        </form>
      )}

      <div className="crew-actions cl-foot">
        {!isPoster && isSignedIn && <ReportButton targetType="call" targetId={call.id} title={call.title} className="crew-mono" />}
        {isAdmin && !isPoster && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this call from the board?')) setStatus('removed').then(() => router.push('/crew/calls')); }}>Remove (admin)</button>}
      </div>
    </div>
  );
}

/* ---------------- post a call ---------------- */

function PostCall({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, projects, preselect, near }) {
  const router = useRouter();
  const [form, setForm] = useState({ title: '', role: CREW_ROLES[0], spots: 1, payType: 'paid', payNote: '', startsOn: '', endsOn: '', remote: false, place: near ? { label: near.label, lat: near.lat, lng: near.lng } : null, project: preselect || '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [type, id] = form.project ? form.project.split(':') : [null, null];
      const body = { ...form, project: type ? { type, id } : null };
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
          <form className="crew-panel cl-postform" onSubmit={submit}>
            <span className="crew-eyebrow">Post a call</span>
            <label className="crew-field"><span>Title</span><input type="text" className="crew-input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Gaffer for two nights" maxLength={80} required /></label>
            <div className="crew-row2">
              <label className="crew-field"><span>Role needed</span>
                <select className="crew-select" value={form.role} onChange={(e) => set({ role: e.target.value })}>{CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              </label>
              <label className="crew-field"><span>Spots</span><input type="number" className="crew-input" min="1" max={MAX_SPOTS} value={form.spots} onChange={(e) => set({ spots: e.target.value })} /></label>
            </div>
            <div className="crew-row2">
              <label className="crew-field"><span>Pay</span>
                <select className="crew-select" value={form.payType} onChange={(e) => set({ payType: e.target.value })}>{Object.entries(PAY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="crew-field"><span>Pay details</span><input type="text" className="crew-input" value={form.payNote} onChange={(e) => set({ payNote: e.target.value })} placeholder={PAY_HINT[form.payType]} maxLength={120} /></label>
            </div>
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
            <label className="crew-field"><span>Details</span><textarea className="crew-input" rows={6} value={form.details} onChange={(e) => set({ details: e.target.value })} placeholder="What the days look like, what you have already, what they should bring." maxLength={2000} /></label>
            {error && <div className="crew-status error" role="alert">{error}</div>}
            <div className="crew-actions"><button type="submit" className="crew-btn primary" disabled={busy}>{busy ? 'Posting…' : 'Post the call'}</button><Link href="/crew/calls" className="crew-btn ghost">Cancel</Link></div>
          </form>
          <aside className="crew-aside">
            <div className="crew-panel crew-wc-side">
              <h3>Who hears about it</h3>
              <p className="crew-muted" style={{ margin: 0 }}>Everyone whose working card lists <b>{form.role}</b> and whose place + travel radius reaches {form.remote ? 'anywhere (remote call)' : form.place ? form.place.label : 'the place you pick'} gets a notification and an email. People can switch call emails off on their card.</p>
            </div>
            <div className="crew-panel crew-wc-side">
              <h3>Rules</h3>
              <ul className="cl-rules">
                <li>Pay is labelled — paid, union, deferred, unpaid, other. No money moves through the site.</li>
                <li>Responses land in your Messages with the call attached. Book from the call page.</li>
                <li>After the last day you'll be asked who worked it — that's what builds people's track record.</li>
                <li>Calls close a week after the last day. Up to 10 open at a time.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
