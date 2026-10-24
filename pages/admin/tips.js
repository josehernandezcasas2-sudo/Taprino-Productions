import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { dollars } from '../../lib/purchaseRules';

// Tips, the studio's view (mockup 2026-10-24; migration 101). Recent tips
// with both names (the tipper's even when the creator can't see it),
// reported notes with Hide / Dismiss, and refunds. A refund is final:
// reverse_transfer + refund_application_fee like a backing, Stripe keeps
// its fee and the studio absorbs it; fan and creator each get a
// notification. Full admins only: refunds move real money. There is no
// account ban in the codebase, so "block tipper" from the mockup is not
// here; a report on the tipper's profile is the path.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

async function call(path, method, body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const H = ({ children }) => <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-faint)', margin: '0 0 0.5rem' }}>{children}</h3>;

export default function TipsAdmin({ account, mainGenres, apiPath = '/api/admin/tips' }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [q, setQ] = useState('');

  async function load() {
    try { setData(await call(apiPath, 'GET')); setError(null); } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key, body, done) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await call(apiPath, 'POST', body);
      setNotice(done);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  const refund = (t) => {
    const reason = window.prompt(`Refund the ${dollars(t.amountCents)} tip from ${t.tipperName} to ${t.creatorName}? This is final: the fan gets ${dollars(t.totalCents)} back, Stripe keeps its fee (${dollars(t.feeCents)}, the studio absorbs it) and ${dollars(t.creatorCents)} comes back out of the creator's balance. Reason (kept on the record):`);
    if (reason === null) return;
    act(t.id, { action: 'refund', tipId: t.id, reason }, 'Refunded.');
  };
  const hide = (t) => {
    if (!window.confirm(t.noteHidden ? 'Keep this note hidden and close the report as upheld?' : 'Hide this note from the creator? The tip itself stays; the report is closed as upheld.')) return;
    act(`hide:${t.id}`, { action: 'hide_note', tipId: t.id }, 'Note hidden.');
  };
  const dismiss = (t) => act(`dismiss:${t.id}`, { action: 'dismiss', tipId: t.id }, 'Report dismissed.');

  const rows = data ? data.recent : [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((t) => [t.creatorName, t.tipperName, t.tipperEmail, t.note].filter(Boolean).some((s) => String(s).toLowerCase().includes(needle))) : rows;

  return (
    <AdminShell title="Tips" account={account} mainGenres={mainGenres} crumbs={['Money']}>
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {notice && <div className="crew-status ok" style={{ marginBottom: '0.8rem' }}>{notice}</div>}
      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && !data.available && <div className="crew-panel">Run migration 088 (Creator Share tables) and 101 (Tips) in Supabase first.</div>}
      {data && data.available && (
        <div style={{ display: 'grid', gap: '1.4rem' }}>
          <div className="nums" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <Stat n={dollars(data.monthCents)} label="tipped this month" />
            <Stat n={dollars(data.monthKeptCents)} label="kept by the studio" />
            <Stat n={data.reported.length} label="notes reported" warn={data.reported.length > 0} />
            <Stat n={rows.filter((t) => t.status === 'refunded').length} label="refunded (last 100)" />
          </div>
          <p className="crew-muted" style={{ margin: 0, maxWidth: '70ch' }}>
            A tip goes to the creator&rsquo;s Stripe account the moment the card clears; the fan covers the card fee and the studio keeps its cut of the tip. The Tip button shows only once a creator&rsquo;s payouts are ready. Refunds here are final and the only refunds there are. The cut (5%, never more than $100 from one tip) and the biggest tip ($500) are in <Link href="/admin/settings">Settings</Link>; the Terms read them live.
          </p>

          {data.reported.length > 0 && (
            <section className="crew-panel" style={{ borderColor: 'rgba(var(--danger-rgb), 0.4)', background: 'rgba(var(--danger-rgb), 0.06)', display: 'grid', gap: '0.6rem' }}>
              <H>Reported notes · {data.reported.length}</H>
              {data.reported.map((r) => (
                <div key={r.reportId} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem' }}>
                    <b>{fmt(r.tip.completedAt)}</b> · to {r.tip.creatorName} · from {r.tip.tipperName}{r.tip.showName ? '' : ' (name hidden from the creator)'} · {dollars(r.tip.amountCents)} · &ldquo;{r.tip.note}&rdquo;
                    <span className="crew-mono"> · reported by {r.reporterName}{r.reason ? `: ${r.reason}` : ''}</span>
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {/* The creator may have hidden it already: upholding keeps it hidden and closes the report. */}
                    <button type="button" className="crew-btn sm" disabled={busy !== null} onClick={() => hide(r.tip)}>{busy === `hide:${r.tip.id}` ? 'Hiding…' : r.tip.noteHidden ? 'Uphold (keep hidden)' : 'Hide note'}</button>
                    <button type="button" className="crew-btn sm ghost" disabled={busy !== null} onClick={() => dismiss(r.tip)}>{busy === `dismiss:${r.tip.id}` ? '…' : 'Dismiss'}</button>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <H>Recent tips · {shown.length}{needle ? ` of ${rows.length}` : ''}</H>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="creator, tipper or note" aria-label="Search tips" style={{ minHeight: 40, borderRadius: 999, border: '1px solid rgba(251, 232, 211, 0.18)', background: 'var(--surface-1)', color: 'var(--ink)', padding: '0 0.9rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', width: 260, maxWidth: '100%' }} />
            </div>
            {rows.length === 0 && <div className="crew-mono">No tips yet.</div>}
            <div className="crew-results">
              {shown.map((t) => (
                <div key={t.id} className="crew-panel" style={{ display: 'grid', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div>
                      <b>{dollars(t.amountCents)} to <Link href={`/profile/${t.creatorId}`}>{t.creatorName}</Link></b>
                      <div className="crew-mono">
                        from {t.tipperName}{t.tipperEmail ? ` · ${t.tipperEmail}` : ''}{t.showName ? '' : ' · name hidden from the creator'} · {fmt(t.completedAt)}
                      </div>
                    </div>
                    <span className={`payouts-pill ${t.status === 'refunded' ? 'failed' : t.status === 'disputed' ? 'pending' : 'paid'}`}>
                      {t.status === 'refunded' ? `Refunded ${fmt(t.refundedAt)}` : t.status === 'disputed' ? 'Disputed' : 'Paid'}
                    </span>
                  </div>
                  <div className="crew-mono">
                    Fan paid {dollars(t.totalCents)} · card fee {dollars(t.feeCents)} (fan) · creator {dollars(t.creatorCents)} · studio {dollars(t.cutCents)} ({t.cutPercent}%)
                    {t.refundReason ? ` · ${t.refundReason}` : ''}
                    {t.dispute ? ` · dispute ${t.dispute.status}${t.dispute.clawbackCents ? `, ${dollars(t.dispute.clawbackCents)} taken back` : ''}` : ''}
                  </div>
                  {t.note && <div style={{ fontSize: '0.9rem', color: t.noteHidden ? 'var(--ink-faint)' : 'var(--ink-dim)' }}>&ldquo;{t.note}&rdquo;{t.noteHidden ? ' · hidden' : ''}</div>}
                  {t.status === 'completed' && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" className="crew-btn sm" disabled={busy !== null} onClick={() => refund(t)}>{busy === t.id ? 'Refunding…' : 'Refund (final)'}</button>
                      {t.note && !t.noteHidden && <button type="button" className="crew-btn sm ghost" disabled={busy !== null} onClick={() => hide(t)}>Hide note</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}

function Stat({ n, label, warn }) {
  return (
    <div className="crew-panel" style={{ padding: '0.7rem 0.9rem' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: warn ? 'var(--danger)' : 'var(--ink)' }}>{n}</div>
      <div className="crew-mono">{label}</div>
    </div>
  );
}
