import { useEffect, useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';

// Private beta → Invites (migration 098, lib/betaInvites.js). Who can get
// through the door while PRIVATE_BETA is on: send Clerk invitations (the
// email with the link that creates an account), work the requests people
// left at /welcome, and see who joined. Full admins only.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

async function call(path, method, body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const H = ({ children, aside }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', margin: '0 0 0.5rem' }}>
    <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: 0 }}>{children}</h3>
    {aside}
  </div>
);
const PILL = { pending: 'pending', accepted: 'joined', revoked: 'revoked' };

export default function InvitesAdmin({ account, mainGenres, apiPath = '/api/admin/invites' }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    try { setData(await call(apiPath, 'GET')); setError(null); } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key, body, done) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const out = await call(apiPath, 'POST', body);
      setNotice(typeof done === 'function' ? done(out) : done);
      await load();
      return out;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  const sentSummary = (out) => `${out.sent.length} sent${out.failed.length ? `; ${out.failed.map((f) => `${f.email}: ${f.error}`).join(' · ')}` : '.'}`;
  const list = emails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  async function sendInvites(e) {
    e.preventDefault();
    const out = await act('send', { action: 'invite', emails: list, note }, sentSummary);
    if (out && out.failed.length === 0) { setEmails(''); setNote(''); }
  }
  const inviteRequest = (r) => act(r.id, { action: 'invite', emails: [r.email], note: r.kindLabel }, sentSummary);
  const dismiss = (r) => act(r.id, { action: 'dismiss', requestId: r.id }, 'Dismissed.');
  const revoke = (i) => { if (window.confirm(`Revoke the invitation to ${i.email}? The link in their email stops working.`)) act(i.id, { action: 'revoke', id: i.id }, 'Revoked.'); };
  const resend = (i) => act(i.id, { action: 'resend', id: i.id }, 'A fresh invitation email is on its way.');

  const waiting = data ? data.requests.filter((r) => r.status === 'waiting') : [];
  const decided = data ? data.requests.filter((r) => r.status !== 'waiting') : [];

  return (
    <AdminShell
      title="Invites"
      account={account}
      mainGenres={mainGenres}
      crumbs={['People']}
      intro="Who can get through the door while the site is private."
      actions={data && (
        <span className={`payouts-pill ${data.enabled ? 'paid' : 'failed'}`} title="The PRIVATE_BETA environment variable in Vercel">
          Private beta · {data.enabled ? 'ON' : 'OFF'}
        </span>
      )}
    >
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {notice && <div className="crew-status ok" style={{ marginBottom: '0.8rem' }}>{notice}</div>}
      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && (
        <div style={{ display: 'grid', gap: '1.4rem' }}>
          {!data.available && <div className="crew-panel">Run migration 098 (beta_requests) in Supabase: invitations still work, but requests from the door can’t be saved until then.</div>}
          {data.clerkError && <div className="crew-status error">Clerk didn’t answer for the invitation list: {data.clerkError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', alignItems: 'start' }}>
            <form className="crew-panel" onSubmit={sendInvites} style={{ display: 'grid', gap: '0.6rem' }}>
              <H>Send invites</H>
              <p className="crew-muted" style={{ margin: 0 }}>One email per line. Each gets Clerk’s invitation email with a link that creates their account on /welcome. Someone who already has an account just signs in.</p>
              <textarea className="crew-input" rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={'maria@example.com\ndp.crew@example.com'} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }} />
              <label className="crew-field"><span>Note on the row (optional)</span>
                <input className="crew-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="creator · DP from the Oakland shoot · …" />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="crew-btn primary" disabled={busy !== null || list.length === 0}>{busy === 'send' ? 'Sending…' : `Send ${list.length || ''} invite${list.length === 1 ? '' : 's'}`}</button>
              </div>
            </form>

            <div className="crew-panel" style={{ display: 'grid', gap: '0.6rem' }}>
              <H>At a glance</H>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                <Stat n={data.counts.sent} label="sent" />
                <Stat n={data.counts.joined} label="joined" ok />
                <Stat n={data.counts.pending} label="open" />
                <Stat n={data.counts.waiting} label="asking" warn={data.counts.waiting > 0} />
              </div>
              <p className="crew-muted" style={{ margin: 0 }}>
                The door is the <b>PRIVATE_BETA</b> variable in Vercel (on = locked, blank = open). Pair it with Clerk → User &amp; authentication → Restrictions → <b>Sign-up mode: Restricted</b>, so only these addresses can make an account; sign-ins by invited people work in the app too. When the site launches, blank the variable and set Clerk back to Public: nothing here needs undoing.
              </p>
            </div>
          </div>

          <section>
            <H aside={waiting.length > 0 && <span className="payouts-pill transit">{waiting.length} waiting</span>}>Requests from the door</H>
            {waiting.length === 0 && <div className="crew-mono">Nobody waiting.</div>}
            <div className="crew-results">
              {waiting.map((r) => (
                <div key={r.id} className="crew-panel" style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ overflowWrap: 'anywhere' }}>{r.email}</b>
                    <div className="crew-mono">{r.kindLabel} · asked {fmt(r.createdAt)}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button type="button" className="crew-btn primary sm" disabled={busy !== null} onClick={() => inviteRequest(r)}>{busy === r.id ? '…' : 'Invite'}</button>
                    <button type="button" className="crew-btn ghost sm" disabled={busy !== null} onClick={() => dismiss(r)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <H aside={<span className="crew-mono">from Clerk, live</span>}>Invites sent · {data.invitations.length}</H>
            {data.invitations.length === 0 && !data.clerkError && <div className="crew-mono">None yet.</div>}
            <div className="crew-results">
              {data.invitations.map((i) => (
                <div key={i.id} className="crew-panel" style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ overflowWrap: 'anywhere' }}>{i.email}</b>
                    <div className="crew-mono">sent {fmt(i.createdAt)}{i.note ? ` · ${i.note}` : ''}{i.kind && !i.note ? ` · ${i.kind}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <span className={`payouts-pill ${i.status === 'accepted' ? 'paid' : i.status === 'revoked' ? 'failed' : 'held'}`}>{PILL[i.status] || i.status}</span>
                    {i.status === 'pending' && (
                      <>
                        <button type="button" className="crew-btn sm" disabled={busy !== null} onClick={() => resend(i)}>{busy === i.id ? '…' : 'Resend'}</button>
                        <button type="button" className="crew-btn ghost sm" disabled={busy !== null} onClick={() => revoke(i)}>Revoke</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {decided.length > 0 && (
            <section>
              <H>Earlier requests · {decided.length}</H>
              <div className="crew-results">
                {decided.map((r) => (
                  <div key={r.id} className="crew-panel" style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', opacity: 0.75 }}>
                    <div style={{ minWidth: 0 }}>
                      <b style={{ overflowWrap: 'anywhere' }}>{r.email}</b>
                      <div className="crew-mono">{r.kindLabel} · asked {fmt(r.createdAt)} · {r.status} {fmt(r.decidedAt)}</div>
                    </div>
                    {r.status === 'dismissed' && <button type="button" className="crew-btn sm" disabled={busy !== null} onClick={() => inviteRequest(r)}>Invite after all</button>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AdminShell>
  );
}

function Stat({ n, label, ok, warn }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: ok ? 'var(--ok)' : warn ? 'var(--olive)' : 'var(--ink)' }}>{n}</div>
      <div className="crew-mono">{label}</div>
    </div>
  );
}
