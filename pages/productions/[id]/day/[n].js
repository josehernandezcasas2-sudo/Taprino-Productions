import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import ProductionShell, { shellProps } from '../../../../components/productions/ProductionShell';
import { StatusPill, fmtDay } from '../../../../components/productions/ProductionBits';
import DayForm from '../../../../components/productions/DayForm';
import { Avatar } from '../../../../components/crew/CrewBits';
import TierChip from '../../../../components/crew/TierChip';
import { getAccountContext } from '../../../../lib/accountContext';
import { getPublicEpisodes } from '../../../../lib/publicEpisodes';
import { getCallSheet, bookedPlacesFor } from '../../../../lib/productions';

// The call sheet for one shoot day: who, where, when — with the address,
// access notes and house rules when the place is a Studio Tapa listing.
// For the crew on the production, the owner and admins; prints clean.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let sheet = null;
  let problem = null;
  if (!account.isSignedIn) problem = 'signin';
  else {
    try {
      sheet = await getCallSheet(String(params.id), Number(params.n) || 1, { viewerId: account.userId, isAdmin: account.isAdmin });
    } catch (err) {
      if (err.status === 403) problem = 'crew';
      else if (err.status === 404 || err.status === 503) problem = 'missing';
      else throw err;
    }
  }
  const bookedPlaces = sheet && sheet.canEdit ? await bookedPlacesFor(sheet.production.owner.userId).catch(() => []) : [];
  return { props: { ...shellProps(account, episodes), sheet: sheet ? JSON.parse(JSON.stringify(sheet)) : null, problem, bookedPlaces, productionId: String(params.id) } };
}

export default function CallSheetPage(props) {
  const { sheet: initial, problem, bookedPlaces, productionId } = props;
  const [sheet, setSheet] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setSheet(initial); setEditing(false); }, [initial]);

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

  async function reload(dayNo) {
    const res = await fetch(`/api/productions/${productionId}/sheet?day=${dayNo}`);
    const json = await res.json();
    if (res.ok) { setSheet(json); setEditing(false); if (dayNo !== Number(props.sheet && props.sheet.day.dayNo)) window.history.replaceState(null, '', `/productions/${productionId}/day/${dayNo}`); }
  }

  if (problem || !sheet) {
    return (
      <ProductionShell title="Call sheet" {...props}>
        <div className="crew-crumbs"><Link href="/productions">Productions</Link><span>/</span><Link href={`/productions/${productionId}`}>Production</Link><span>/</span><span>Call sheet</span></div>
        <div className="crew-panel crew-empty">
          {problem === 'signin' && <>The call sheet is for the crew. <SignInButton mode="modal"><button type="button" className="crew-btn sm primary" style={{ marginLeft: '0.5rem' }}>Sign in</button></SignInButton></>}
          {problem === 'crew' && <>The call sheet is for the crew on this production. Ask the owner to add you.</>}
          {problem === 'missing' && <>That shoot day isn’t on the sheet.</>}
          <br /><Link href={`/productions/${productionId}`} className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to the production</Link>
        </div>
      </ProductionShell>
    );
  }

  const { production: p, day, days, departments, crewCount, listing, requestHref, canEdit } = sheet;
  const idx = days.findIndex((d) => d.dayNo === day.dayNo);
  const prev = idx > 0 ? days[idx - 1] : null;
  const next = idx >= 0 && idx < days.length - 1 ? days[idx + 1] : null;

  return (
    <ProductionShell title={`${p.title} · Day ${day.dayNo}`} {...props}>
      <div className="crew-crumbs no-print"><Link href="/productions">Productions</Link><span>/</span><Link href={`/productions/${p.id}`}>{p.title}</Link><span>/</span><span>Day {day.dayNo}</span></div>

      <div className="sheet">
        <header className="sheet-head">
          <div>
            <span className="crew-eyebrow">Call sheet · {p.kindLabel}</span>
            <h1 className="prod-h1">{p.title}</h1>
            <div className="sheet-day">Day {day.dayNo} of {days.length} · {fmtDay(day.shootOn)}</div>
          </div>
          <div className="sheet-times">
            <div><small>Crew call</small><b>{day.callTime || '—'}</b></div>
            <div><small>Wrap</small><b>{day.wrapTime || '—'}</b></div>
            <div><small>On the crew</small><b>{crewCount}</b></div>
          </div>
        </header>

        <nav className="sheet-nav no-print" aria-label="Shoot days">
          {prev ? <button type="button" className="crew-btn sm" onClick={() => reload(prev.dayNo)}>‹ Day {prev.dayNo}</button> : <span />}
          <div className="crew-chips">{days.map((d) => <button key={d.id} type="button" className={`crew-tab${d.dayNo === day.dayNo ? ' on' : ''}`} onClick={() => reload(d.dayNo)}>Day {d.dayNo} · {d.label.replace(/^\w+, /, '')}</button>)}</div>
          {next ? <button type="button" className="crew-btn sm" onClick={() => reload(next.dayNo)}>Day {next.dayNo} ›</button> : <span />}
        </nav>

        {error && <div className="crew-status error" role="alert">{error}</div>}

        <div className="sheet-grid">
          <section className="crew-panel sheet-block">
            <h2 className="cc-h4">Where</h2>
            <div className="sheet-place">{day.placeLabel || 'Place to confirm'}</div>
            {day.address && <div className="sheet-addr">{day.address}</div>}
            {listing && (
              <div className="sheet-listing">
                {listing.coverUrl && <img src={listing.coverUrl} alt="" className="sheet-cover" />}
                <div>
                  <div className="crew-mono">Booked through <Link href={listing.href}>Locations</Link>{listing.hostName ? ` · hosted by ${listing.hostName}` : ''}{requestHref && <> · <Link href={requestHref}>the booking</Link></>}</div>
                  {listing.accessNotes && <p><b>Getting in.</b> {listing.accessNotes}</p>}
                  {listing.rules && <p><b>House rules.</b> {listing.rules}</p>}
                  <div className="cc-when">
                    {listing.hoursFrom && listing.hoursTo && <span>Hours {listing.hoursFrom}–{listing.hoursTo}</span>}
                    {listing.crewMax && <span>Crew up to {listing.crewMax}</span>}
                    {listing.power && <span>Power: {listing.power}</span>}
                    {listing.sound && <span>Sound: {listing.sound}</span>}
                    {listing.coiRequired && <span>COI required</span>}
                    {listing.permitHelp && <span>Permits: {listing.permitHelp}</span>}
                  </div>
                </div>
              </div>
            )}
            {day.parking && <p><b>Parking & arrival.</b> {day.parking}</p>}
          </section>

          <section className="crew-panel sheet-block">
            <h2 className="cc-h4">The day</h2>
            {day.scenes && <p><b>Shooting.</b> {day.scenes}</p>}
            {day.notes && <p className="cc-details">{day.notes}</p>}
            {!day.scenes && !day.notes && <p className="crew-muted" style={{ margin: 0 }}>No notes for this day yet.</p>}
            {p.notes && <><h3 className="cc-h4">Production notes</h3><p className="cc-details">{p.notes}</p></>}
            <div className="crew-mono">Run by {p.owner.displayName}{p.place ? ` · based in ${p.place.label}` : ''} · <StatusPill status={p.status} label={p.statusLabel} /></div>
          </section>
        </div>

        <section className="crew-panel sheet-block">
          <h2 className="cc-h4">Crew · {crewCount}</h2>
          {departments.length === 0 && <p className="crew-muted" style={{ margin: 0 }}>Nobody on the list yet.</p>}
          <div className="sheet-crew">
            {departments.map((d) => (
              <div key={d.name} className="sheet-dept">
                <h3>{d.name}</h3>
                {d.members.map((m) => (
                  <div key={m.id} className="sheet-person">
                    <Avatar userId={m.person.userId} name={m.person.displayName} src={m.person.avatarUrl} position={m.person.avatarPosition} zoom={m.person.avatarZoom} size="sm" />
                    <span className="sheet-person-name"><Link href={m.person.profilePath}>{m.person.displayName}</Link> <TierChip person={m.person} showCount={false} /></span>
                    <span className="sheet-person-role">{m.role}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <div className="crew-actions no-print">
          <button type="button" className="crew-btn sm" onClick={() => window.print()}>Print / save as PDF</button>
          {canEdit && !editing && <button type="button" className="crew-btn sm" onClick={() => setEditing(true)}>Edit this day</button>}
          {canEdit && <button type="button" className="crew-btn sm ghost" disabled={busy} onClick={async () => { if (window.confirm(`Remove Day ${day.dayNo} from the sheet?`)) { const r = await api(`/api/productions/${p.id}/days`, { dayId: day.id }, 'DELETE'); if (r) window.location.href = `/productions/${p.id}`; } }}>Remove this day</button>}
          <Link href={`/productions/${p.id}`} className="crew-btn sm ghost">Back to the production</Link>
        </div>

        {canEdit && editing && (
          <section className="crew-panel sheet-block no-print">
            <h2 className="cc-h4">Edit Day {day.dayNo}</h2>
            <DayForm productionId={p.id} initial={day} busy={busy} api={api} bookedPlaces={bookedPlaces} onDone={() => reload(day.dayNo)} onCancel={() => setEditing(false)} />
          </section>
        )}
      </div>
    </ProductionShell>
  );
}
