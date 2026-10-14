import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { StatusChip } from '../../components/locations/RequestBits';
import { fmtRange } from '../../components/locations/LocationBits';
import { dollars } from '../../lib/locationRules';

// Locations, admin side (migration 086). New places are approved from
// the review queue (dashboard / /admin/review, kind "Place"); this page
// is for everything after: hosts' damage and no-show reports, bookings
// whose host went quiet after the last day, refunds (full, final, the
// platform absorbs Stripe's fee like Pitch Room), and pulling a place.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['handle_flags'] });
}

async function call(path, method, body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const H = ({ children }) => <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>{children}</h3>;

export default function LocationsAdmin({ account, mainGenres, apiPath = '/api/admin/locations' }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('bookings');

  async function load() {
    try { setData(await call(apiPath, 'GET')); setError(null); } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key, body) {
    setBusy(key);
    setError(null);
    try { await call(apiPath, 'POST', body); await load(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  }
  const refund = (r) => {
    const reason = window.prompt(`Refund ${dollars(r.totalChargedCents)} to ${r.producer.displayName} in full? This is final; Stripe keeps its processing fee. Reason (shown to both):`);
    if (reason === null) return;
    act(r.id, { op: 'refund', requestId: r.id, reason });
  };

  return (
    <AdminShell title="Locations" account={account} mainGenres={mainGenres}>
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && (
        <div style={{ display: 'grid', gap: '1.4rem' }}>
          <div className="nums" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <Stat n={data.pendingCount} label="waiting on review" href="/admin/review" />
            <Stat n={data.totals.listed} label="listed" />
            <Stat n={data.issues.length} label="reported problems" warn={data.issues.length > 0} />
            <Stat n={data.settle.length} label="hosts gone quiet" warn={data.settle.length > 0} />
            <Stat n={dollars(data.totals.paidCents)} label="booked, paid" />
            <Stat n={dollars(data.totals.cutCents)} label="platform cut" />
          </div>
          {data.pendingCount > 0 && <div className="crew-panel crew-rhead"><span>{data.pendingCount} {data.pendingCount === 1 ? 'place is' : 'places are'} waiting on approval.</span><Link href="/admin/review" className="crew-btn sm primary">Open the review queue</Link></div>}

          {data.issues.length > 0 && (
            <section>
              <H>Reported problems · {data.issues.length}</H>
              <p className="crew-muted" style={{ margin: '0 0 0.6rem', maxWidth: '64ch' }}>A host said a paid shoot ended in damage or a no-show. Read both sides in the conversation, then refund (full, final) or leave the booking as paid. Nothing happens automatically.</p>
              <div className="crew-results">{data.issues.map((r) => <BookingRow key={r.id} r={r} busy={busy} onRefund={() => refund(r)} showNote />)}</div>
            </section>
          )}

          {data.settle.length > 0 && (
            <section>
              <H>Hosts gone quiet · {data.settle.length}</H>
              <p className="crew-muted" style={{ margin: '0 0 0.6rem', maxWidth: '64ch' }}>Paid bookings past their last day where the host hasn’t said how it went. “As agreed” is the credit on both records; the producer can’t do this themselves.</p>
              <div className="crew-results">
                {data.settle.map((r) => (
                  <BookingRow key={r.id} r={r} busy={busy} onRefund={() => refund(r)}>
                    <button type="button" className="crew-btn sm primary" disabled={busy === r.id} onClick={() => act(r.id, { op: 'outcome', requestId: r.id, outcome: 'as_agreed', note: 'Settled by an admin' })}>As agreed</button>
                    <button type="button" className="crew-btn sm" disabled={busy === r.id} onClick={() => act(r.id, { op: 'outcome', requestId: r.id, outcome: 'cancelled', note: 'Settled by an admin: did not happen' })}>Didn’t happen</button>
                  </BookingRow>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="crew-subnav" role="tablist" style={{ marginBottom: '0.6rem' }}>
              <button type="button" role="tab" aria-selected={tab === 'bookings'} onClick={() => setTab('bookings')}>Bookings · {data.bookings.length}</button>
              <button type="button" role="tab" aria-selected={tab === 'listings'} onClick={() => setTab('listings')}>Places · {data.listings.length}</button>
            </div>
            {tab === 'bookings' && (
              <>
                {data.bookings.length === 0 && <div className="crew-panel crew-empty">No paid bookings yet.</div>}
                <div className="crew-results">{data.bookings.map((r) => <BookingRow key={r.id} r={r} busy={busy} onRefund={['paid', 'done'].includes(r.status) ? () => refund(r) : null} />)}</div>
              </>
            )}
            {tab === 'listings' && (
              <>
                {data.listings.length === 0 && <div className="crew-panel crew-empty">Nothing listed yet.</div>}
                <div className="crew-results">
                  {data.listings.map((l) => (
                    <div key={l.id} className="crew-panel crew-rhead">
                      <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
                        <span className="loc-row-thumb" style={{ width: 56, flex: 'none', ...(l.coverUrl ? { backgroundImage: `url(${l.coverUrl})` } : {}) }} />
                        <span><Link href={`/locations/${l.id}`}>{l.title}</Link> <span className="crew-mono">· {l.kindLabel} · {l.place || '—'}{l.host ? <> · by <Link href={l.host.profilePath}>{l.host.displayName}</Link></> : ''} · {l.status}{l.verified ? ' · ✓ verified' : ''}{l.shootsCount ? ` · hosted ${l.shootsCount}` : ''}{l.reports ? <b style={{ color: 'var(--danger)' }}> · {l.reports} {l.reports === 1 ? 'report' : 'reports'}</b> : ''}</span></span>
                      </span>
                      <span className="crew-actions">
                        {l.status === 'listed' && <button type="button" className="crew-btn sm" disabled={busy === l.id} onClick={() => act(l.id, { op: 'pause', locationId: l.id })}>Pause</button>}
                        <button type="button" className="crew-btn sm ghost" style={{ color: 'var(--danger)' }} disabled={busy === l.id} onClick={() => { if (window.confirm(`Remove “${l.title}”? The host keeps their bookings; the listing goes.`)) act(l.id, { op: 'remove', locationId: l.id }); }}>Remove</button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
          <p className="crew-muted" style={{ maxWidth: '70ch' }}>Refunds reverse the host’s transfer and return the platform cut; Stripe keeps its processing fee, which the platform absorbs. A refund made in the Stripe dashboard is mirrored here through the webhook. Flags and reports on places are handled on <Link href="/admin/content">All content &amp; flags</Link> like any other title.</p>
        </div>
      )}
    </AdminShell>
  );
}

function Stat({ n, label, href, warn }) {
  const body = <><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', display: 'block', color: warn ? 'var(--danger)' : 'var(--ink)' }}>{n}</b><span className="crew-mono" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span></>;
  return href ? <Link href={href} className="crew-panel" style={{ textDecoration: 'none', display: 'block' }}>{body}</Link> : <div className="crew-panel">{body}</div>;
}

function BookingRow({ r, busy, onRefund, showNote, children }) {
  return (
    <div className="crew-panel" style={{ display: 'grid', gap: '0.4rem' }}>
      <div className="crew-rhead">
        <span><Link href={`/locations/requests/${r.id}`}>{r.projectTitle || r.shooting}</Link> · {fmtRange(r.startsOn, r.endsOn)} <span className="crew-mono">· {r.listing ? <Link href={`/locations/${r.listing.id}`}>{r.listing.title}</Link> : 'a place'} · <Link href={r.producer.profilePath}>{r.producer.displayName}</Link> → <Link href={r.host.profilePath}>{r.host.displayName}</Link></span></span>
        <StatusChip r={r} />
      </div>
      <span className="crew-mono">Producer paid {dollars(r.totalChargedCents)} · host receives {dollars(r.hostPayoutCents)} · cut {dollars(r.platformCutCents)}{r.refundCents != null ? ` · refunded ${dollars(r.refundCents)}${r.refundReason ? ` (${r.refundReason})` : ''}` : ''}{r.paidAt ? ` · paid ${new Date(r.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
      {showNote && r.outcomeNote && <p className="loc-reqcard-msg" style={{ margin: 0 }}><b style={{ color: 'var(--danger)' }}>{r.outcome.replace('_', ' ')}:</b> “{r.outcomeNote}”</p>}
      <span className="crew-actions">
        {children}
        {onRefund && <button type="button" className="crew-btn sm" style={{ color: 'var(--danger)' }} disabled={busy === r.id} onClick={onRefund}>Refund in full</button>}
        {r.threadId && <Link href={`/messages/${r.threadId}`} className="crew-btn sm ghost">Conversation</Link>}
        <Link href={`/locations/requests/${r.id}`} className="crew-btn sm ghost">Open</Link>
      </span>
    </div>
  );
}
