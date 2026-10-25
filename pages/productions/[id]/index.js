import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import ProductionShell, { shellProps } from '../../../components/productions/ProductionShell';
import { StatusPill, PersonLine, fmtRange, fmtDay } from '../../../components/productions/ProductionBits';
import { Avatar } from '../../../components/crew/CrewBits';
import TierChip from '../../../components/crew/TierChip';
import DayForm from '../../../components/productions/DayForm';
import ReportButton from '../../../components/ReportButton';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getProduction, ownReleaseOptions, bookedPlacesFor } from '../../../lib/productions';
import { CREW_ROLES } from '../../../lib/crewOptions';
import { OWNER_STATUSES, PRODUCTION_STATUS, MAX_ROLE_CHARS } from '../../../lib/productionRules';

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
  }
  return { props: { ...shellProps(account, episodes), data: data ? JSON.parse(JSON.stringify(data)) : null, notFound, setupError, releases, bookedPlaces } };
}

const payClass = (t) => (t === 'paid' || t === 'union' ? 'paid' : t === 'deferred' ? 'deferred' : 'unpaid');

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

  const { production: p, members, days, calls, isOwner, isMember, canEdit, canConfirm, confirmHint } = data;

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
  const confirmed = members.filter((m) => m.worked).length;

  return (
    <ProductionShell title={p.title} description={p.logline || undefined} {...props}>
      <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><span>{p.title}</span></div>

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
                <select className="crew-select" value={p.status} disabled={busy} onChange={(e) => api(`/api/productions/${p.id}`, { status: e.target.value }, 'PATCH')}>
                  {OWNER_STATUSES.map((s) => <option key={s} value={s}>{PRODUCTION_STATUS[s]}</option>)}
                </select>
              </label>
              <div className="crew-actions">
                <Link href={`/productions/${p.id}/edit`} className="crew-btn sm">Edit details</Link>
                <Link href={`/crew/calls/new?production=${p.id}`} className="crew-btn sm primary">+ Post a call</Link>
                <Link href="/locations" className="crew-btn sm">Book a place</Link>
                <Link href={`/productions/${p.id}/distribution`} className="crew-btn sm">Distribution & screeners</Link>
              </div>
            </>
          )}
          {!canEdit && isMember && (
            <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={async () => { if (window.confirm('Take yourself off this production? Your credit on it goes too.')) { const r = await api(`/api/productions/${p.id}/members`, { op: 'leave' }); if (r) router.replace(router.asPath); } }}>Take me off this</button>
          )}
          {!isSignedIn && <SignInButton mode="modal"><button type="button" className="crew-btn sm">Sign in</button></SignInButton>}
        </div>
      </header>

      {note && <div className="crew-status ok" role="status">{note}</div>}
      {error && <div className="crew-status error" role="alert">{error}</div>}

      <div className="prod-grid2">
        <div className="prod-col">
          {/* ---- crew ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead">
              <h2 className="cc-h2">Crew · {members.length}</h2>
              <span className="crew-mono">{confirmed} confirmed worked{p.release ? ' · credited on the release' : ''}</span>
            </div>
            {members.length === 0 && <div className="crew-muted">Nobody on it yet.{isOwner ? ' Book people through a call posted for this production, or add them below.' : ''}</div>}
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
                        {!m.worked && !m.mine && canConfirm && <button type="button" className="crew-btn sm primary" disabled={busy} onClick={() => api(`/api/productions/${p.id}/members`, { memberId: m.id, worked: true }, 'PATCH')}>Worked it</button>}
                        {m.worked && isAdmin && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => api(`/api/productions/${p.id}/members`, { memberId: m.id, worked: false }, 'PATCH')}>Undo</button>}
                        <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.person.displayName} from the crew list?`)) api(`/api/productions/${p.id}/members`, { memberId: m.id }, 'DELETE'); }}>Remove</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {canEdit && members.some((m) => !m.worked && !m.mine) && confirmHint && <div className="crew-mono">{confirmHint}</div>}
            {canEdit && <AddMember productionId={p.id} busy={busy} onResult={(r) => { if (r && r.production) setData(r); }} api={api} />}
          </section>

          {/* ---- open calls ---- */}
          <section className="crew-panel prod-section">
            <div className="crew-rhead">
              <h2 className="cc-h2">Crew needed</h2>
              {isOwner && <Link href={`/crew/calls/new?production=${p.id}`} className="crew-btn sm">+ Post a call</Link>}
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
            {days.length === 0 && <div className="crew-muted">No shoot days on the sheet yet.{isOwner ? ' Add them below, or book a place under this production and its dates land here.' : ''}</div>}
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

/* ---- owner: add someone by name / @handle ---- */

function AddMember({ productionId, busy, api }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState(null); // { userId, displayName }
  const [people, setPeople] = useState([]);

  useEffect(() => {
    if (!open || picked || q.trim().length < 2 || q.trim().startsWith('@')) { setPeople([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crew/people?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (res.ok) setPeople((data.people || []).slice(0, 6));
      } catch (err) { /* nothing */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, picked]);

  async function submit(e) {
    e.preventDefault();
    const body = picked ? { userId: picked.userId, role } : { handle: q.trim(), role };
    const r = await api(`/api/productions/${productionId}/members`, body);
    if (r) { setQ(''); setRole(''); setPicked(null); setPeople([]); }
  }

  if (!open) return <div><button type="button" className="crew-btn sm" onClick={() => setOpen(true)}>+ Add someone</button></div>;
  return (
    <form className="prod-add" onSubmit={submit}>
      <div className="crew-field" style={{ position: 'relative' }}><span>Who</span>
        <input type="text" className="crew-input" value={picked ? picked.displayName : q} onChange={(e) => { setPicked(null); setQ(e.target.value); }} placeholder="Name on Crew Call, or @handle" autoComplete="off" />
        {people.length > 0 && !picked && (
          <div className="prod-suggest" role="listbox">
            {people.map((x) => <button key={x.userId} type="button" onClick={() => { setPicked({ userId: x.userId, displayName: x.displayName }); setPeople([]); }}><Avatar userId={x.userId} name={x.displayName} src={x.avatarUrl} position={x.avatarPosition} zoom={x.avatarZoom} size="sm" /><span>{x.displayName}{x.handle ? <small> @{x.handle}</small> : null}</span><small>{(x.roles || []).slice(0, 3).join(', ')}</small></button>)}
          </div>
        )}
      </div>
      <label className="crew-field"><span>Role</span>
        <input type="text" className="crew-input" list="prod-roles" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Gaffer" maxLength={MAX_ROLE_CHARS} required />
        <datalist id="prod-roles">{CREW_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      </label>
      <div className="crew-actions">
        <button type="submit" className="crew-btn sm primary" disabled={busy || (!picked && q.trim().length < 2) || role.trim().length < 2}>Add</button>
        <button type="button" className="crew-btn sm ghost" onClick={() => { setOpen(false); setPicked(null); setQ(''); }}>Cancel</button>
        <span className="crew-mono">They get a notification and can take themselves off.</span>
      </div>
    </form>
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
