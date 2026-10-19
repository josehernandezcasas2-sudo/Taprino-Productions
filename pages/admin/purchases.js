import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { dollars } from '../../lib/purchaseRules';

// Buy to own, the studio's view (migration 097). Prices are approved from
// the review queue (kind "Price"); this page is what happens after:
// recent sales with the split, admin refunds (final; Stripe keeps its
// processing fee, the platform absorbs it; the creator's share is
// reversed), and the legal-takedown refund of every buyer of a title.
// Full admins only: refunds move real money.
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

export default function PurchasesAdmin({ account, mainGenres, apiPath = '/api/admin/purchases' }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  const refund = (p) => {
    const reason = window.prompt(`Refund ${dollars(p.paidCents)} to ${p.buyerName}? This is final: they lose the title, Stripe keeps its processing fee (${dollars(p.feeCents)}, the studio absorbs it) and ${p.house ? 'nothing' : `${dollars(p.creatorCents)}`} comes back out of the creator's balance. Reason (kept on the record):`);
    if (reason === null) return;
    act(p.id, { action: 'refund', purchaseId: p.id, reason }, 'Refunded.');
  };
  const refundAll = (p) => {
    const reason = window.prompt(`Refund EVERY buyer of "${p.title}"? Only for a legal takedown (a copyright claim, a court order): the rule is that buyers keep what they bought. Reason (sent nowhere, kept on each record):`);
    if (reason === null) return;
    act(`all:${p.type}:${p.targetId}`, { action: 'refund_all', type: p.type, id: p.targetId, reason }, (out) => `${out.refunded} refunded${out.failed.length ? `, ${out.failed.length} failed: ${out.failed.map((f) => f.error).join('; ')}` : ''}.`);
  };

  const rows = data ? data.purchases : [];
  const completed = rows.filter((r) => r.status === 'completed');
  const gross = completed.reduce((s, r) => s + r.paidCents, 0);
  const platform = completed.reduce((s, r) => s + r.platformCents - r.feeCents, 0);
  const toCreators = completed.reduce((s, r) => s + r.creatorCents, 0);

  return (
    <AdminShell title="Title sales" account={account} mainGenres={mainGenres} crumbs={['Money']}>
      {error && <div className="crew-status error" style={{ marginBottom: '0.8rem' }}>{error}</div>}
      {notice && <div className="crew-status ok" style={{ marginBottom: '0.8rem' }}>{notice}</div>}
      {!data && !error && <div className="crew-mono">Loading…</div>}
      {data && !data.available && <div className="crew-panel">Run migration 097 (Buy to own) in Supabase first.</div>}
      {data && data.available && (
        <div style={{ display: 'grid', gap: '1.4rem' }}>
          <div className="nums" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <Stat n={completed.length} label="sales (last 100)" />
            <Stat n={dollars(gross)} label="paid by buyers" />
            <Stat n={dollars(toCreators)} label="to creators" />
            <Stat n={dollars(platform)} label="studio, after Stripe" />
            <Stat n={rows.filter((r) => r.status === 'refunded').length} label="refunded" />
          </div>
          <p className="crew-muted" style={{ margin: 0, maxWidth: '70ch' }}>
            Prices wait in the <Link href="/admin/review">review queue</Link> (kind Price). Buyers keep what they bought through any creator-side takedown: an approved deletion of a bought title marks it withdrawn and keeps the video (<Link href="/admin/library">Library</Link>). Refunds here are final; buyers refund themselves within the window from their account page.
          </p>
          <section>
            <H>Recent purchases · {rows.length}</H>
            {rows.length === 0 && <div className="crew-mono">Nothing bought yet.</div>}
            <div className="crew-results">
              {rows.map((p) => (
                <div key={p.id} className="crew-panel" style={{ display: 'grid', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div>
                      <b><Link href={p.href}>{p.title}</Link>{p.type === 'series' ? ' · the series' : ''}</b>
                      <div className="crew-mono">{p.buyerName} bought it {fmt(p.completedAt)} · creator {p.creatorName}{p.house ? ' (studio title)' : ''}</div>
                    </div>
                    <span className={`payouts-pill ${p.status === 'refunded' ? 'failed' : 'paid'}`}>{p.status === 'refunded' ? `Refunded ${fmt(p.refundedAt)} · ${p.refundKind}` : 'Paid'}</span>
                  </div>
                  <div className="crew-mono">
                    Paid {dollars(p.paidCents)} · Stripe fee {dollars(p.feeCents)} · creator {dollars(p.creatorCents)} · studio {dollars(p.platformCents - p.feeCents)}
                    {Object.keys(p.watchedMax || {}).length ? ` · watched ${Object.values(p.watchedMax).map((s) => `${Math.round(s / 60)} min`).join(', ')}` : ' · not started'}
                    {p.refundReason ? ` · ${p.refundReason}` : ''}
                  </div>
                  {p.status === 'completed' && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" className="crew-btn sm" disabled={busy !== null} onClick={() => refund(p)}>{busy === p.id ? 'Refunding…' : 'Refund (final)'}</button>
                      <button type="button" className="crew-btn sm ghost" disabled={busy !== null} onClick={() => refundAll(p)}>Legal takedown: refund every buyer of this title</button>
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
