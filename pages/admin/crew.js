import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';

// The Crew Call board, admin side (migration 082). Three lists: jobs
// waiting on a poster who's gone quiet (settle them here — a "worked" is
// a confirmed job on the person's track record), calls people reported,
// and every open call (remove one from the board).
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
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>Reported calls · {data.reported.length}</h3>
            {data.reported.length === 0 && <div className="crew-panel crew-empty">No open reports on calls.</div>}
            <div className="crew-results">
              {data.reported.map((c) => <CallRow key={c.id} c={c} busy={busy} onRemove={() => act(c.id, { op: 'remove', callId: c.id })} />)}
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
