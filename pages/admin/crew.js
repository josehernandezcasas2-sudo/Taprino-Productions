import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { payDollars } from '../../lib/crewPayRules';

// The Crew Call board, admin side (migration 082). Jobs waiting on a
// poster who's gone quiet (settle them here — a "worked" is a confirmed
// job on the person's track record), secured crew pay (migration 110:
// what's held, released, refunded; refund or re-release), calls people
// reported, reported productions, and every open call.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['handle_flags'] });
}

async function call(method, body) {
  const res = await fetch('/api/admin/crew-calls', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

export default function CrewAdmin({ account, mainGenres }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try { setData(await call('GET')); setError(null); } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function act(key, body) {
    setBusy(key);
    try { await call('POST', body); await load(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  }

  return (
    <AdminShell title="Crew Call board" account={account} mainGenres={mainGenres}>
      {error && <div className="crew-status error">{error}</div>}
      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && (
        <div style={{ display: 'grid', gap: '1.4rem' }}>
          <section>
            <h3 className="crew-wc-side" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Waiting on the poster · {data.pending.length}</h3>
            <p className="crew-muted" style={{ margin: '0 0 0.6rem', maxWidth: '64ch' }}>Booked people on calls whose last day has passed, with no answer from the poster yet. Settle it here if they've gone quiet — "Worked it" is a confirmed job on the person's track record.</p>
            {data.pending.length === 0 && <div className="crew-panel crew-empty">Nothing waiting.</div>}
            <div className="crew-results">
              {data.pending.map((p) => (
                <div key={p.responseId} className="crew-panel crew-rhead">
                  <span><Link href={p.worker.profilePath}>{p.worker.displayName}</Link> · {p.role} on <Link href={`/crew/calls/${p.callId}`}>{p.title}</Link> <span className="crew-mono">· ended {fmt(p.endsOn)} · posted by <Link href={p.poster.profilePath}>{p.poster.displayName}</Link></span></span>
                  <span className="crew-actions">
                    <button type="button" className="crew-btn sm primary" disabled={busy === p.responseId} onClick={() => act(p.responseId, { op: 'outcome', callId: p.callId, responseId: p.responseId, outcome: 'worked' })}>Worked it</button>
                    <button type="button" className="crew-btn sm" disabled={busy === p.responseId} onClick={() => act(p.responseId, { op: 'outcome', callId: p.callId, responseId: p.responseId, outcome: 'no_show' })}>Didn't happen</button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Secured crew pay · {data.pay && data.pay.payments ? data.pay.payments.length : 0}</h3>
            {data.pay && !data.pay.ready && <div className="crew-panel crew-empty">Secured pay isn’t set up yet — run migration 110.{data.pay.error ? ` (${data.pay.error})` : ''}</div>}
            {data.pay && data.pay.ready && (
              <>
                <p className="crew-muted" style={{ margin: '0 0 0.6rem', maxWidth: '70ch' }}>
                  Money posters put up for booked people (migration 110). <b>{payDollars(data.pay.heldCents)}</b> held right now{data.pay.waiting ? `, ${data.pay.waiting} confirmed ${data.pay.waiting === 1 ? 'job' : 'jobs'} waiting on the worker’s payout account` : ''} · {payDollars(data.pay.cutCents)} in service fees on held and paid-out jobs. A held payment is released when the job is settled as “worked” (here or by the poster); refund one only when both sides agree the job is off. Released money is reversed from the Stripe dashboard, not here.
                </p>
                {data.pay.payments.length === 0 && <div className="crew-panel crew-empty">Nobody has secured pay yet.</div>}
                <div className="crew-results">
                  {data.pay.payments.map((p) => (
                    <div key={p.id} className="crew-panel crew-rhead">
                      <span>
                        <b>{payDollars(p.amountCents)}</b> <span className={`crew-chip ${p.status === 'held' ? 'olive' : p.status === 'released' ? 'ok' : 'mute'}`}>{p.statusLabel}{p.status === 'held' && p.releaseRequestedAt ? ' · waiting on payout account' : ''}</span> <Link href={p.poster.profilePath}>{p.poster.displayName}</Link> → <Link href={p.worker.profilePath}>{p.worker.displayName}</Link> · {p.call.role} on <Link href={`/crew/calls/${p.call.id}`}>{p.call.title}</Link>
                        <span className="crew-mono"> · charged {payDollars(p.totalCents)} (fee {payDollars(p.cutCents)} + card {payDollars(p.feeCents)}) · job {p.outcome || 'not settled'}{p.call.endsOn ? ` · ended ${fmt(p.call.endsOn)}` : ''}{p.refundedCents != null ? ` · refunded ${payDollars(p.refundedCents)}${p.refundReason ? ` (${p.refundReason})` : ''}` : ''}{p.failedReason ? ` · ${p.failedReason}` : ''}</span>
                      </span>
                      {p.status === 'held' && account.isAdmin && (
                        <span className="crew-actions">
                          {p.outcome === 'worked' && <button type="button" className="crew-btn sm primary" disabled={busy === p.id} onClick={() => act(p.id, { op: 'release_pay', paymentId: p.id })}>Release again</button>}
                          <button type="button" className="crew-btn sm" disabled={busy === p.id} onClick={() => { const reason = window.prompt(`Refund ${payDollars(p.totalCents)} to ${p.poster.displayName}? Say why (both sides are told):`); if (reason != null) act(p.id, { op: 'refund_pay', paymentId: p.id, reason }); }}>Refund</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Reported calls · {data.reported.length}</h3>
            {data.reported.length === 0 && <div className="crew-panel crew-empty">No open reports on calls.</div>}
            <div className="crew-results">
              {data.reported.map((c) => <CallRow key={c.id} c={c} busy={busy} onRemove={() => act(c.id, { op: 'remove', callId: c.id })} />)}
            </div>
          </section>

          <section>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Reported productions · {(data.productions || []).length}</h3>
            {(data.productions || []).length === 0 && <div className="crew-panel crew-empty">No open reports on productions.</div>}
            <div className="crew-results">
              {(data.productions || []).map((p) => (
                <div key={p.id} className="crew-panel crew-rhead">
                  <span><Link href={`/productions/${p.id}`}>{p.title}</Link> <span className="crew-mono">· {p.kindLabel} · {p.statusLabel} · by <Link href={p.owner.profilePath}>{p.owner.displayName}</Link> · {p.reports} {p.reports === 1 ? 'report' : 'reports'}</span></span>
                  <span className="crew-actions">
                    <Link href={`/productions/${p.id}`} className="crew-btn sm">Open</Link>
                    <button type="button" className="crew-btn sm" disabled={busy === p.id} onClick={() => { if (window.confirm('Take this production down?')) act(p.id, { op: 'remove_production', productionId: p.id }); }}>Take it down</button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Open calls · {data.open.length}</h3>
            {data.open.length === 0 && <div className="crew-panel crew-empty">Nothing on the board right now.</div>}
            <div className="crew-results">
              {data.open.map((c) => <CallRow key={c.id} c={c} busy={busy} onRemove={() => act(c.id, { op: 'remove', callId: c.id })} />)}
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}

function CallRow({ c, busy, onRemove }) {
  return (
    <div className="crew-panel crew-rhead">
      <span>
        <Link href={`/crew/calls/${c.id}`}>{c.title}</Link> <span className="crew-mono">· {c.role} · {c.payLabel}{c.payNote ? ` · ${c.payNote}` : ''} · {c.remote ? 'remote' : c.place} · by <Link href={c.poster.profilePath}>{c.poster.displayName}</Link> · {c.responsesCount} responses{c.reports ? ` · ${c.reports} ${c.reports === 1 ? 'report' : 'reports'}` : ''}</span>
      </span>
      <button type="button" className="crew-btn sm ghost" style={{ color: 'var(--danger)' }} disabled={busy === c.id} onClick={() => { if (window.confirm(`Remove "${c.title}" from the board?`)) onRemove(); }}>Remove</button>
    </div>
  );
}
