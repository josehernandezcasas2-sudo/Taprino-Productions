import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import SignInHere from '../../../components/SignInHere';
import ProductionShell, { shellProps } from '../../../components/productions/ProductionShell';
import { StatusPill, PersonLine, fmtRange, fmtDay } from '../../../components/productions/ProductionBits';
import { Avatar } from '../../../components/crew/CrewBits';
import TierChip from '../../../components/crew/TierChip';
import DayForm from '../../../components/productions/DayForm';
import AddMember from '../../../components/productions/AddMember';
import ReportButton from '../../../components/ReportButton';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getProduction, ownReleaseOptions, bookedPlacesFor } from '../../../lib/productions';
import { OWNER_STATUSES, PRODUCTION_STATUS } from '../../../lib/productionRules';
import { DASH_WORDS, MANAGER_STATUSES, PITCH_WORDS, isProducerRole, productionFundingCard } from '../../../lib/productionDashRules';

// One production: what it is, who's on it, the shoot days, the open
// calls, the release. The owner runs it from here (status, crew, days,
// release link); the crew open the call sheet from here.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let data = null;
  let notFound = false;
  let setupError = false;
  try {
    data = await getProduction(String(params.id), { viewerId: account.userId || null, isAdmin: account.isAdmin });
  } catch (err) {
    if (err.status === 404) notFound = true;
    else if (err.status === 503) setupError = true;
    else throw err;
  }
  let releases = [];
  let bookedPlaces = [];
  if (data && data.isOwner) {
    [releases, bookedPlaces] = await Promise.all([ownReleaseOptions(account.userId).catch(() => []), bookedPlacesFor(account.userId).catch(() => [])]);
  } else if (data && data.canManage && account.userId) {
    // A listed producer attaches the places they booked themselves.
    bookedPlaces = await bookedPlacesFor(account.userId).catch(() => []);
  }
  return { props: { ...shellProps(account, episodes), data: data ? JSON.parse(JSON.stringify(data)) : null, notFound, setupError, releases, bookedPlaces } };
}

const payClass = (t) => (t === 'paid' || t === 'union' ? 'paid' : t === 'deferred' ? 'deferred' : 'unpaid');

// A conversation about this production, with someone on it
// (/messages resolves the subject and opens an existing conversation).
const messageHref = (userId, productionId) => `/messages?to=${encodeURIComponent(userId)}&kind=production&ref=${encodeURIComponent(productionId)}`;

export default function ProductionPage(props) {
  const { data: initial, notFound, setupError, isSignedIn, viewerId, isAdmin, releases, bookedPlaces } = props;
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  useEffect(() => { setData(initial); }, [initial]);

  if (notFound || setupError || !data) {
    return (
      <ProductionShell title="Not here" {...props}>
        <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><span>Not found</span></div>
        <div className="crew-panel crew-empty">{setupError ? 'Productions aren’t set up on this site yet.' : 'That production isn’t here — it may be private, or gone.'}<br /><Link href="/productions" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to productions</Link></div>
      </ProductionShell>
    );
  }

  const { production: p, members, days, calls, isOwner, isMember, canEdit, canConfirm, confirmHint, canOwn = isOwner || isAdmin, dashboardHref = null, funding = null } = data;

  async function api(url, body, method = 'POST') {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Something went wrong.');
      if (json.production) setData(json);
      return json;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const byDept = {};
  for (const m of members) (byDept[m.department] = byDept[m.department] || []).push(m);
  const inside = isOwner || isMember || isAdmin;
  // On the crew (not the owner): a way to write to the producer.
  const writeProducer = Boolean(isMember && !isOwner && p.owner && p.owner.userId && p.owner.userId !== viewerId);
  const confirmed = members.filter((m) => m.worked).length;
  const fundingCard = productionFundingCard(funding);

  return (
    <ProductionShell title={p.title} description={p.logline || undefined} {...props}>
      <div className="crew-crumbs prod-crumbs-row">
        <span><Link href="/productions">Productions</Link><span>/</span><span>{p.title}</span></span>
        {dashboardHref && <Link href={dashboardHref} className="prod-dash-link">{DASH_WORDS.link} ›</Link>}
      </div>

      <header className="crew-panel prod-hero">
        <div className="prod-hero-main">
          <div className="prod-card-top">
            <StatusPill status={p.status} label={p.statusLabel} />
            <span className="crew-chip">{p.kindLabel}</span>
            {p.visibility !== 'public' && <span className="crew-chip mute">{p.visibility === 'crew' ? 'crew only' : 'private'}</span>}
            {p.moderationHold && <span className="crew-chip warn">on hold — under review</span>}
          </div>
          <h1 className="prod-h1">{p.title}</h1>
          {p.logline && <p className="prod-log">{p.logline}</p>}
          <div className="cc-kv prod-kv">
            <span>When</span><span>{fmtRange(p.startsOn, p.endsOn)}{days.length ? ` · ${days.length} shoot ${days.length === 1 ? 'day' : 'days'} on the sheet` : ''}</span>
            {p.place && <><span>Based in</span><span>{p.place.label}</span></>}
            {p.projectTitle && <><span>Grew out of</span><span><Link href={p.projectType === 'pitch' ? `/pitches/${p.projectId}` : `/series/${p.projectId}`} className="crew-chip pitch">{p.projectType === 'pitch' ? 'Pitch Room' : 'Series'} · {p.projectTitle}</Link></span></>}
            {p.release && <><span>Released as</span><span><Link href={p.release.href} className="crew-chip ok">▶ {p.release.title} · on Studio Tapa</Link></span></>}
            <span>Run by</span><span><PersonLine p={p.owner} /></span>
          </div>
        </div>
        <div className="prod-hero-side">
          {canEdit && (
            <>
              <label className="crew-field"><span>Status</span>
                <select className="crew-select" value={p.status} disabled={busy || (!canOwn && ['archived', 'removed'].includes(p.status))} onChange={(e) => api(`/api/productions/${p.id}`, { status: e.target.value }, 'PATCH')}>
                  {(canOwn ? OWNER_STATUSES : [...MANAGER_STATUSES, ...(MANAGER_STATUSES.includes(p.status) ? [] : [p.status])]).map((s) => <option key={s} value={s}>{PRODUCTION_STATUS[s]}</option>)}
                </select>
              </label>
              <div className="crew-actions">
                <Link href={`/productions/${p.id}/edit`} className="crew-btn sm">Edit details</Link>
                <Link href={`/crew/calls/new?production=${p.id}`} className="crew-btn sm primary">+ Post a call</Link>
                <Link href="/locations" className="crew-btn sm">Book a place</Link>
                {canOwn && <Link href={`/productions/${p.id}/distribution`} className="crew-btn sm">Distribution & screeners</Link>}
                <Link href="/resources?kind=paperwork" className="crew-btn sm ghost" title="Release forms, deal memos, NDAs, location agreements — from the Resources directory">Paperwork templates</Link>
              </div>
            </>
          )}
          {writeProducer || (!canEdit && isMember) ? (
            <div className="crew-actions">
              {/* The production's conversations stay between the people on it
                  (lib/messageContext.js): a crew member writes to the producer
                  from here, the subject the production itself. */}
              {writeProducer && (
                <Link href={messageHref(p.owner.userId, p.id)} className="crew-btn sm">Message the producer</Link>
              )}
              {!canEdit && isMember && (
                <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={async () => { if (window.confirm('Take yourself off this production? Your credit on it goes too.')) { const r = await api(`/api/productions/${p.id}/members`, { op: 'leave' }); if (r) router.replace(router.asPath); } }}>Take me off this</button>
              )}
            </div>
          ) : null}
          {!isSignedIn && <SignInHere><button type="button" className="crew-btn sm">Sign in</button></SignInHere>}
        </div>
      </header>

      {note && <div className="crew-status ok" role="status">{note}</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}

      {/* The pitch it grew out of, still taking backing (2026-11-19). */}
      {fundingCard && (
        <section className="crew-panel prod-funding" aria-label={PITCH_WORDS.fundingCard}>
          <div className="prod-funding-top">
            <span className="crew-mono">{fundingCard.kicker}</span>
            {fundingCard.percent != null && <span className="prod-funding-pct">{fundingCard.percent}%</span>}
          </div>
          <div className="prod-funding-main">{fundingCard.line}</div>
          {fundingCard.percent != null && <div className="prod-funding-bar" aria-hidden="true"><span style={{ width: `${fundingCard.percent}%` }} /></div>}
          <Link href={fundingCard.button.href} className={`crew-btn sm${fundingCard.button.primary ? ' primary' : ''}`}>{fundingCard.button.label} ›</Link>
        </section>
      )}

      <div className="prod-grid2">
        <div className="prod-col">
          {/* ---- crew ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead">
              <h2 className="cc-h2">Crew · {members.length}</h2>
              <span className="crew-mono">{confirmed} confirmed worked{p.release ? ' · credited on the release' : ''}</span>
            </div>
            {members.length === 0 && <div className="crew-muted">Nobody on it yet.{canEdit ? ' Book people through a call posted for this production, or add them below.' : ''}</div>}
            {(isOwner || isMember) && <div className="crew-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>Release forms, deal memos, NDAs, location agreements: <Link href="/resources?kind=paperwork">Paperwork &amp; legal</Link> in Resources.</div>}
            {Object.entries(byDept).map(([dept, list]) => (
              <div key={dept} className="prod-dept">
                <h4 className="cc-h4">{dept}</h4>
                {list.map((m) => (
                  <div key={m.id} className={`prod-member${m.worked ? ' worked' : ''}`}>
                    <Avatar userId={m.person.userId} name={m.person.displayName} src={m.person.avatarUrl} position={m.person.avatarPosition} zoom={m.person.avatarZoom} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div className="crew-pname"><Link href={m.person.profilePath}>{m.person.displayName}</Link>{m.person.verified && <span className="crew-ver">✓ creator</span>}<TierChip person={m.person} /></div>
                      <div className="crew-chips">
                        <span className="crew-chip role">{m.role}</span>
                        {m.viaCall && <span className="crew-chip mute">via a call</span>}
                        {m.worked && <span className="crew-chip ok">✓ worked it</span>}
                        {m.mine && <span className="crew-chip pink">you</span>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="cc-resp-acts">
                        {m.person.userId && m.person.userId !== viewerId && <Link href={messageHref(m.person.userId, p.id)} className="crew-btn sm">Message</Link>}
                        {!m.worked && !m.mine && canConfirm && <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => api(`/api/productions/${p.id}/members`, { memberId: m.id, worked: true }, 'PATCH')}>Worked it</button>}
                        {m.worked && isAdmin && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => api(`/api/productions/${p.id}/members`, { memberId: m.id, worked: false }, 'PATCH')}>Undo</button>}
                        {(canOwn || (m.person.userId !== p.owner.userId && !isProducerRole(m.role))) && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.person.displayName} from the crew list?`)) api(`/api/productions/${p.id}/members`, { memberId: m.id }, 'DELETE'); }}>Remove</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {canEdit && members.some((m) => !m.worked && !m.mine) && confirmHint && <div className="crew-mono">{confirmHint}</div>}
            {canEdit && <div id="add-crew"><AddMember productionId={p.id} busy={busy} api={api} /></div>}
          </section>

          {/* ---- open calls ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead">
              <h2 className="cc-h2">Crew needed</h2>
              {canEdit && <Link href={`/crew/calls/new?production=${p.id}`} className="crew-btn sm">+ Post a call</Link>}
            </div>
            {calls.length === 0 && <div className="crew-muted">No open calls for this production right now.</div>}
            <div className="cc-list">
              {calls.map((c) => (
                <Link key={c.id} href={`/crew/calls/${c.id}`} className="crew-panel cc-call">
                  <div className="cc-title">{c.title}<span className={`cc-pay ${payClass(c.payType)}`}>{c.payLabel}</span></div>
                  <div className="cc-when"><span>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''}</span><span>{fmtRange(c.startsOn, c.endsOn)}</span><span>{c.remote ? 'Remote' : c.place}</span><span>{c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</span></div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="prod-col">
          {/* ---- shoot days ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead">
              <h2 className="cc-h2">Shoot days · {days.length}</h2>
              {inside && days.length > 0 && <span className="crew-mono">open a day for the call sheet</span>}
            </div>
            {days.length === 0 && <div className="crew-muted">No shoot days on the sheet yet.{canEdit ? ' Add them below, or book a place under this production and its dates land here.' : ''}</div>}
            <div className="prod-days">
              {days.map((d) => (
                inside
                  ? <Link key={d.id} href={`/productions/${p.id}/day/${d.dayNo}`} className={`prod-day${d.past ? ' past' : ''}`}><b>Day {d.dayNo}</b><span>{d.label}</span><span>{d.callTime ? `call ${d.callTime}` : ''}{d.wrapTime ? ` · wrap ${d.wrapTime}` : ''}</span><span className="prod-day-place">{d.placeLabel || 'Place to confirm'}</span><span className="prod-day-go">Call sheet ›</span></Link>
                  : <div key={d.id} className={`prod-day${d.past ? ' past' : ''}`}><b>Day {d.dayNo}</b><span>{d.label}</span><span className="prod-day-place">{d.placeLabel || ''}</span></div>
              ))}
            </div>
            {canEdit && <AddDay productionId={p.id} busy={busy} api={api} bookedPlaces={bookedPlaces} defaultDate={days.length ? null : p.startsOn} />}
            {!inside && days.length > 0 && <div className="crew-mono">Call times, addresses and house rules are on the call sheet, for the crew.</div>}
          </section>

          {/* ---- notes (crew) ---- */}
          {inside && p.notes && (
            <section className="crew-panel prod-section">
              <h2 className="cc-h2">Notes for the crew</h2>
              <p className="cc-details">{p.notes}</p>
            </section>
          )}

          {/* ---- release ---- */}
          <section className="crew-panel prod-section">
            <h2 className="cc-h2">The release</h2>
            {p.release ? (
              <>
                <p className="crew-muted" style={{ margin: 0 }}>Out on Studio Tapa as <Link href={p.release.href}><b>{p.release.title}</b></Link>. Everyone confirmed above has it on their profile with their role.</p>
                {isOwner && <div className="crew-actions"><button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Unlink the release? The crew’s credits for it come off their profiles until you link it again.')) api(`/api/productions/${p.id}`, { release: null }, 'PATCH'); }}>Unlink</button></div>}
              </>
            ) : isOwner ? (
              <LinkRelease productionId={p.id} releases={releases} busy={busy} api={api} />
            ) : (
              <p className="crew-muted" style={{ margin: 0 }}>Not released on Studio Tapa yet. When it is, the people confirmed above get the credit.</p>
            )}
          </section>
        </div>
      </div>

      <div className="crew-actions cc-foot">
        {isSignedIn && !isOwner && <ReportButton targetType="production" targetId={p.id} title={p.title} className="crew-mono" />}
        {isAdmin && !isOwner && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this production from the site?')) api(`/api/productions/${p.id}`, { status: 'removed' }, 'PATCH').then((r) => r && router.push('/productions')); }}>Remove (admin)</button>}
        {isOwner && p.status !== 'archived' && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('Archive this production? It leaves the public list; you keep it.')) api(`/api/productions/${p.id}`, { status: 'archived' }, 'PATCH'); }}>Archive</button>}
      </div>
    </ProductionShell>
  );
}

function AddDay({ productionId, busy, api, bookedPlaces, defaultDate }) {
  const [open, setOpen] = useState(false);
  if (!open) return <div><button type="button" className="crew-btn sm" onClick={() => setOpen(true)}>+ Add a shoot day</button></div>;
  return <DayForm productionId={productionId} busy={busy} api={api} bookedPlaces={bookedPlaces} defaultDate={defaultDate} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}

/* ---- owner: link the released title ---- */

function LinkRelease({ productionId, releases, busy, api }) {
  const [value, setValue] = useState('');
  if (releases.length === 0) {
    return <p className="crew-muted" style={{ margin: 0 }}>When the finished title is live on Studio Tapa (uploaded by you and approved), it shows up here to link — and everyone confirmed on the crew gets the credit.</p>;
  }
  return (
    <form className="prod-add" onSubmit={(e) => { e.preventDefault(); const [type, id] = value.split(':'); if (type && id) api(`/api/productions/${productionId}`, { release: { type, id } }, 'PATCH'); }}>
      <label className="crew-field"><span>Released on Studio Tapa as</span>
        <select className="crew-select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Pick the title…</option>
          {releases.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <div className="crew-actions">
        <button type="submit" className="crew-btn sm primary" disabled={busy || !value}>Link it</button>
        <span className="crew-mono">Everyone marked “worked it” gets the credit with their role, and a heads-up.</span>
      </div>
    </form>
  );
}
