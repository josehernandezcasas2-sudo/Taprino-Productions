import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Avatar } from '../../../components/crew/CrewBits';
import { LocationShell, Crumbs, HostedChip, fmtRange, hoursLabel } from '../../../components/locations/LocationBits';
import { StatusChip, MoneyLine, HostAnswer, ProducerActions, OutcomeForm, EndorseForm } from '../../../components/locations/RequestBits';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { getRequest } from '../../../lib/locationRequests';
import { CANCELLATION, dollars } from '../../../lib/locationRules';

// One booking request, both sides (mockups/locations-v1.html §3): what
// was asked, the money, where it stands, and the next action for
// whoever is looking. Once paid, the producer sees the street address
// and access notes here.
export async function getServerSideProps({ req, res, params }) {
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
  if (!account.isSignedIn) return { props: { ...base, request: null, problem: 'Sign in to see this request.' } };
  try {
    const request = JSON.parse(JSON.stringify(await getRequest(String(params.id), { viewerId: account.userId, isAdmin: account.isAdmin })));
    return { props: { ...base, request, problem: null } };
  } catch (err) {
    return { props: { ...base, request: null, problem: err.status === 404 ? 'That request isn’t here.' : err.status === 403 ? 'That request isn’t yours.' : err.message } };
  }
}

const STEPS = [['requested', 'Requested'], ['accepted', 'Accepted'], ['paid', 'Paid'], ['done', 'Done']];
function stepIndex(r) {
  if (r.status === 'done' || r.status === 'refunded') return 3;
  if (r.status === 'paid') return 2;
  if (r.status === 'accepted') return 1;
  return 0;
}

export default function RequestPage({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, viewerId, request: initial, problem }) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [note, setNote] = useState(null);
  const shell = { mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber };

  useEffect(() => {
    if (router.query.paid === '1') setNote('Payment received — Stripe is confirming it. The address shows here as soon as it does (refresh in a moment).');
    else if (router.query.paid === 'cancelled') setNote('Payment cancelled — the request is still accepted; pay when you’re ready.');
  }, [router.query.paid]);

  // After returning from Stripe the webhook may land a second later.
  useEffect(() => {
    if (router.query.paid !== '1' || !r || r.status === 'paid') return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/locations/requests/${r.id}`);
        const d = await res.json();
        if (res.ok && d.request.status !== r.status) { setR(d.request); setNote(null); clearInterval(t); }
      } catch { /* keep trying */ }
      if (tries >= 10) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [router.query.paid, r]);

  if (!r) {
    return (
      <LocationShell title="Request" {...shell}>
        <Crumbs items={[{ href: '/locations', label: 'Locations' }, { label: 'Request' }]} />
        <div className="crew-panel crew-empty">{problem}<br /><Link href="/locations" className="crew-btn sm" style={{ marginTop: '0.6rem' }}>Back to Locations</Link></div>
      </LocationShell>
    );
  }

  const side = r.mineAsHost ? 'host' : r.mineAsProducer ? 'producer' : 'admin';
  const other = side === 'host' ? r.producer : r.host;
  const l = r.listing;
  const idx = stepIndex(r);
  const dead = ['declined', 'expired', 'cancelled'].includes(r.status);
  const paidSide = ['paid', 'done', 'refunded'].includes(r.status);

  return (
    <LocationShell title={`${r.projectTitle || r.shooting} · ${fmtRange(r.startsOn, r.endsOn)}`} {...shell}>
      <Crumbs items={[{ href: '/locations', label: 'Locations' }, { href: side === 'host' ? '/locations/mine' : '/locations/requests', label: side === 'host' ? 'Your places' : 'Your requests' }, { label: 'Request' }]} />
      <div className="crew-head">
        <div>
          <span className="crew-eyebrow">{side === 'host' ? 'A request for your place' : 'Your request'}</span>
          <h1 style={{ fontSize: '1.7rem' }}>{r.projectTitle || r.shooting}</h1>
          <p>{l ? <Link href={`/locations/${l.id}`}>{l.title}</Link> : 'A place'} · {fmtRange(r.startsOn, r.endsOn)}{r.hoursFrom && r.hoursTo ? ` · ${hoursLabel(r.hoursFrom, r.hoursTo)}` : ''} · {r.days} {r.days === 1 ? 'day' : 'days'}</p>
        </div>
        <StatusChip r={r} />
      </div>
      {note && <div className="crew-status ok loc-topstatus" role="status">{note}</div>}

      <div className="loc-steps-line" aria-label="Progress">
        {STEPS.map(([k, label], i) => <span key={k} className={`${i <= idx && !dead ? 'on' : ''}${dead && i === 0 ? ' on' : ''}`}>{label}</span>)}
        {dead && <span className="dead">{r.statusLabel}</span>}
      </div>

      <div className="crew-card-grid">
        <div className="crew-wc">
          <section className="crew-panel">
            <h3>The ask</h3>
            <div className="loc-kv">
              <div><span>Dates</span><span>{fmtRange(r.startsOn, r.endsOn)}</span></div>
              <div><span>Hours</span><span>{r.hoursFrom && r.hoursTo ? `${hoursLabel(r.hoursFrom, r.hoursTo)} · ${r.hoursPerDay} hrs a day` : `${r.hoursPerDay} hrs a day`}</span></div>
              {r.crewSize && <div><span>Crew</span><span>{r.crewSize}</span></div>}
              {r.vehicles != null && <div><span>Vehicles</span><span>{r.vehicles}</span></div>}
              {r.projectTitle && <div><span>Project</span><span>{r.projectId ? <Link href={r.projectType === 'pitch' ? `/pitches/${r.projectId}` : `/series/${r.projectId}`}>{r.projectTitle}</Link> : r.projectTitle}</span></div>}
              <div><span>Shooting</span><span>{r.shooting}</span></div>
            </div>
            {r.message && <p className="loc-reqcard-msg" style={{ marginTop: '0.6rem' }}>“{r.message}”</p>}
          </section>

          <section className="crew-panel">
            <h3>Money</h3>
            <div className="loc-kv">
              <div><span>{r.pricing === 'offer' ? 'Offer' : 'Posted rate'}</span><span>{dollars(r.subtotalCents)} for {r.days} {r.days === 1 ? 'day' : 'days'}</span></div>
              {r.cleaningCents > 0 && <div><span>Cleaning</span><span>{dollars(r.cleaningCents)}</span></div>}
              {r.status === 'countered' && <div><span>Host’s counter</span><span>{dollars(r.counterCents)}{r.counterNote ? ` · “${r.counterNote}”` : ''}</span></div>}
              <div><span>Card fee</span><span>{dollars(r.feeCoverCents)} (paid by the producer)</span></div>
              <div><span>Producer pays</span><span><b>{dollars(r.totalChargedCents)}</b></span></div>
              <div><span>Host receives</span><span><b>{dollars(r.hostPayoutCents)}</b> after the {r.cutPercent}% cut</span></div>
              {r.refundCents != null && <div><span>Refunded</span><span>{dollars(r.refundCents)}{r.refundReason ? ` · ${r.refundReason}` : ''}</span></div>}
              {l && <div><span>Cancellation</span><span>{CANCELLATION[l.cancellation].label} · {CANCELLATION[l.cancellation].text}</span></div>}
            </div>
            <span className="crew-mono"><MoneyLine r={r} side={side === 'host' ? 'host' : 'producer'} /></span>
          </section>

          {paidSide && l && (l.address || l.accessNotes) && (
            <section className="crew-panel" style={{ borderColor: 'var(--ok)' }}>
              <h3>Address &amp; access <small>unlocked by the paid booking</small></h3>
              {l.address && <div className="loc-kv"><div><span>Address</span><span>{l.address}</span></div>{l.accessNotes && <div><span>Access</span><span>{l.accessNotes}</span></div>}</div>}
              {l.rules && <p className="crew-muted" style={{ margin: '0.5rem 0 0' }}><b>House rules:</b> {l.rules}</p>}
            </section>
          )}

          {r.outcome && (
            <section className="crew-panel">
              <h3>How it went</h3>
              <div className="crew-chips">
                {r.outcome === 'as_agreed' ? <span className="crew-chip ok">✓ As agreed — a credit on the listing</span> : <span className="crew-chip warn">{r.outcome.replace('_', ' ')} · an admin is looking at it</span>}
              </div>
              {r.outcomeNote && <p className="crew-muted" style={{ margin: '0.5rem 0 0' }}>{r.outcomeNote}</p>}
              {r.endorsements.length > 0 && <div className="loc-kv" style={{ marginTop: '0.5rem' }}>{r.endorsements.map((e) => <div key={e.fromUserId}><span>{e.fromUserId === r.hostId ? r.host.displayName : r.producer.displayName} said</span><span>“{e.line}”</span></div>)}</div>}
            </section>
          )}

          <section className="crew-panel">
            <h3>{side === 'host' ? 'Your answer' : 'Next'}</h3>
            {side === 'host' && <HostAnswer r={r} onChange={setR} />}
            {side === 'producer' && <ProducerActions r={r} onChange={setR} />}
            {side === 'host' && <OutcomeForm r={r} onChange={setR} />}
            <EndorseForm r={r} viewerId={viewerId} onChange={setR} />
            {side === 'host' && r.status === 'accepted' && <span className="crew-mono">Accepted — waiting on {other.displayName.split(' ')[0]} to pay. The dates stay open until they do.</span>}
            {side === 'host' && r.status === 'countered' && <span className="crew-mono">Your counter stands for 48 hours.</span>}
            {r.status === 'paid' && !r.pastEnd && <span className="crew-mono">Confirmed. {side === 'host' ? 'After the last day you’ll be asked how it went.' : 'Take load-in and wrap photos and drop them in the conversation — it keeps everyone honest.'}</span>}
            {r.status === 'paid' && r.pastEnd && side === 'producer' && <span className="crew-mono">The host will confirm how it went; a shoot that went as agreed becomes a credit on the listing.</span>}
            {side === 'host' && ['requested', 'countered'].includes(r.status) && <span className="crew-mono">Accepting needs a payout account (Your places → Payouts) so the booking can be paid to you.</span>}
            {dead && <span className="crew-mono">{r.declineReason ? `“${r.declineReason}”` : 'Nothing more to do here.'}</span>}
          </section>
        </div>

        <aside className="crew-aside">
          <section className="crew-panel crew-wc-side">
            <h3>{side === 'host' ? 'The producer' : 'The host'}</h3>
            <div className="loc-host-row">
              <Avatar userId={other.userId} name={other.displayName} src={other.avatarUrl} position={other.avatarPosition} zoom={other.avatarZoom} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div className="crew-pname"><Link href={other.profilePath}>{other.displayName}</Link>{side === 'producer' && <HostedChip host={other} />}</div>
                {side === 'producer' && <span className="crew-mono">{other.wouldAgain ? `${other.wouldAgain} would shoot here again` : 'No lines yet'}</span>}
              </div>
            </div>
            <div className="crew-actions">
              {r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm">Open the conversation</Link>}
              <Link href={other.profilePath} className="crew-btn sm ghost">Profile</Link>
            </div>
          </section>
          {l && (
            <section className="crew-panel crew-wc-side">
              <h3>The place</h3>
              <Link href={`/locations/${l.id}`} className="loc-row-thumb" style={l.coverUrl ? { backgroundImage: `url(${l.coverUrl})`, width: '100%', aspectRatio: '16 / 10' } : { width: '100%', aspectRatio: '16 / 10' }} aria-label={l.title} />
              <Link href={`/locations/${l.id}`} className="loc-reqcard-t">{l.title}</Link>
              <span className="crew-mono">{l.kindLabel} · {l.place ? l.place.label : ''} · {l.rateLine}</span>
            </section>
          )}
          <section className="crew-panel crew-wc-side">
            <h3>How this works</h3>
            <ul className="cl-rules">
              <li>The host has 48 hours to accept, counter or decline.</li>
              <li>Paying confirms the dates and unlocks the address and access notes.</li>
              <li>Cancelling a paid booking refunds under the listing’s policy; a host cancelling refunds everything.</li>
              <li>After the last day the host says how it went. As agreed = a credit for the production and the host.</li>
            </ul>
          </section>
        </aside>
      </div>
    </LocationShell>
  );
}
