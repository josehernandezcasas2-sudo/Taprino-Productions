import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { REPORT_REASONS } from '../../lib/reportReasons';

// Reported conversations (Messages, migration 080). Messages are private;
// a report brings the last twenty along as a snapshot, which is what
// shows here. Dismiss or uphold; upholding is the note-to-self — the
// person's profile report in All content & flags is where the account
// action (mute/ban the reporter, flag the profile) already lives.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, { caps: ['handle_flags'] });
}

async function call(method, body, status) {
  const res = await fetch(`/api/admin/message-reports${status ? `?status=${status}` : ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmt = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function MessageReportsAdmin({ account, mainGenres }) {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load(s = status) {
    try {
      setReports((await call('GET', null, s)).reports);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { setReports(null); load(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(id, next) {
    setBusy(id);
    try {
      await call('POST', { id, status: next });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Message reports" account={account} mainGenres={mainGenres}>
      <p className="crew-muted" style={{ maxWidth: '64ch' }}>
        Conversations people reported. Messages stay private otherwise — what you see is the snapshot taken when the report was sent. The reporter's profile report on the other person is in <Link href="/admin/content">All content &amp; flags</Link>.
      </p>
      <div className="crew-subnav" role="tablist" style={{ marginTop: '0.8rem' }}>
        {['open', 'dismissed', 'upheld'].map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      {error && <div className="crew-status error">{error}</div>}
      {reports === null && !error && <div className="crew-mono">Loading…</div>}
      {reports && reports.length === 0 && <div className="crew-panel crew-empty">Nothing {status} right now.</div>}
      <div className="crew-results">
        {(reports || []).map((r) => (
          <article key={r.id} className="crew-panel" style={{ display: 'grid', gap: '0.6rem' }}>
            <div className="crew-rhead">
              <span>
                <Link href={r.reporter.profilePath}>{r.reporter.displayName}</Link> reported <Link href={r.reported.profilePath}>{r.reported.displayName}</Link>
                {' '}<span className="crew-chip pink">{REPORT_REASONS[r.reason] || r.reason}</span>
              </span>
              <span className="crew-mono">{fmt(r.createdAt)}</span>
            </div>
            <div className="dm-msgs" style={{ maxHeight: 320 }}>
              {r.messages.length === 0 && <div className="crew-mono">No messages in the snapshot.</div>}
              {r.messages.map((m) => (
                <div key={m.id} className={`dm-msg${m.senderId === r.reporter.userId ? ' me' : ''}`}>
                  <small style={{ marginTop: 0, marginBottom: '0.15rem' }}>{m.senderId === r.reporter.userId ? r.reporter.displayName : r.reported.displayName}</small>
                  {m.body}
                  <small>{fmt(m.createdAt)}</small>
                </div>
              ))}
            </div>
            {status === 'open' && (
              <div className="crew-actions">
                <button type="button" className="crew-btn sm" disabled={busy === r.id} onClick={() => resolve(r.id, 'dismissed')}>Dismiss</button>
                <button type="button" className="crew-btn sm primary" disabled={busy === r.id} onClick={() => resolve(r.id, 'upheld')}>Uphold</button>
                <Link href={r.reported.profilePath} className="crew-btn sm ghost">Open their profile</Link>
              </div>
            )}
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
