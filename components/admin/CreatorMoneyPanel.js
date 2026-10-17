import { useCallback, useEffect, useState } from 'react';
import { dollars } from '../../lib/artistSupportRules';
import { applyBalance } from '../../lib/creatorShareRules';

// /admin/creator-money: what Creator Share's ledger holds this month, who
// the next payout batch would pay and hold, the platform's Stripe balance
// it would draw on, the button that runs it now, and recent payouts.
// Reads and runs through /api/admin/creator-money (full admins only).
// `apiPath` exists for local dev pages.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

const PAYOUT_STATUS = { paid: ['Paid', 'paid'], pending: ['Pending', 'transit'], failed: ['Failed', 'failed'] };

export default function CreatorMoneyPanel({ apiPath = '/api/admin/creator-money' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiPath);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load Creator Share.');
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  }, [apiPath]);
  useEffect(() => { load(); }, [load]);

  // Same rule as the batch (lib/creatorShareRules.js applyBalance): pay in
  // order while the platform's available balance covers it; the rest
  // waits for the next run or a top-up.
  const covered = data ? applyBalance(data.plan.pay, data.balance ? data.balance.availableCents : Infinity) : null;
  const payNow = covered ? covered.pay : [];
  const payNowCents = payNow.reduce((s, p) => s + p.cents, 0);

  async function run() {
    if (!data) return;
    const n = payNow.length;
    const ok = window.confirm(
      `Pay ${n} creator${n === 1 ? '' : 's'} ${dollars(payNowCents)} now?\n\n` +
      'Each one gets a Stripe transfer from the platform balance to their connected account, and the credits are marked paid. This can’t be undone from here.'
    );
    if (!ok) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run' }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'The batch failed.');
      setResult(d);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  if (error && !data) return <p className="rq-error">{error}</p>;
  if (!data) return <p className="adm-empty">Loading…</p>;

  const { summary, plan, balance, recentPayouts } = data;
  const waiting = covered.skippedForBalance;

  return (
    <>
      <div className="adm-stats cm-stats">
        <div className="adm-stat"><b>{dollars(summary.creditedCents)}</b><span>credited · {data.periodLabel}</span></div>
        <div className="adm-stat"><b>{summary.paymentsCount}</b><span>paid invoices this month</span></div>
        <div className="adm-stat"><b>{dollars(summary.reversedCents)}</b><span>reversed this month</span></div>
        <div className="adm-stat"><b>{dollars(summary.paidCents)}</b><span>paid out this month</span></div>
        <div className="adm-stat"><b>{dollars(summary.owedCents)}</b><span>owed to creators now</span></div>
        <div className="adm-stat"><b>{balance ? dollars(balance.availableCents) : '—'}</b><span>{balance ? 'platform balance available' : 'platform balance (Stripe off)'}</span></div>
      </div>

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="adm-card-head">
          <div>
            <div className="account-eyebrow" style={{ marginBottom: 2 }}>Next payout batch</div>
            <div className="cm-sub">Runs on the 1st at 9:00 UTC. Pays every creator at or over {dollars(plan.minimumCents)} whose Stripe account can take money; the rest carries over.</div>
          </div>
          <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} disabled={running || payNow.length === 0} onClick={run}>
            {running ? 'Paying…' : `Run now · ${dollars(payNowCents)}`}
          </button>
        </div>
        {waiting.length > 0 && (
          <p className="rq-error">
            The platform’s available balance ({dollars(balance.availableCents)}) covers {payNow.length} of {plan.pay.length} ({dollars(payNowCents)} of {dollars(plan.payCents)}). {waiting.map((w) => w.displayName).join(', ')} would wait for the next run. Top up in Stripe, or wait for pending funds ({dollars(balance.pendingCents)}) to clear.
          </p>
        )}
        {balance && (balance.payoutInterval === 'daily' || balance.payoutInterval === 'weekly') && (
          <p className="cm-sub" style={{ color: 'var(--warn, var(--olive))', marginTop: '0.4rem' }}>
            Stripe sweeps the platform balance to the bank {balance.payoutInterval}, so it may hold little on the 1st. Set the platform account’s payout schedule to monthly (after the 1st) or manual in Stripe, or add funds before the run.
          </p>
        )}
        {error && <p className="rq-error">{error}</p>}
        {result && (
          <p className="cm-result">
            Ran: <b>{result.paid.length}</b> paid ({dollars(result.paidCents)}){result.failed.length > 0 && <>, <b className="bad">{result.failed.length} failed</b></>}{result.skippedForBalance.length > 0 && <>, {result.skippedForBalance.length} waiting on balance</>}, {result.held.length} held.
            {result.failed.map((f) => <span key={f.creatorId} className="cm-fail">{f.displayName || f.creatorId}: {f.reason}</span>)}
          </p>
        )}

        <div className="cm-cols">
          <div>
            <div className="payouts-list-head" style={{ marginTop: '0.6rem' }}>Will pay · {plan.pay.length}</div>
            {plan.pay.length === 0 ? <p className="adm-empty">Nobody is due yet.</p> : (
              <div className="cm-scroll">
                <table className="cm-table">
                  <thead><tr><th>Creator</th><th>Owed</th><th>Oldest credit</th><th>Stripe</th></tr></thead>
                  <tbody>
                    {plan.pay.map((p) => (
                      <tr key={p.creatorId}>
                        <td>{p.displayName}<span className="bk-email">{p.creatorId}</span></td>
                        <td>{dollars(p.cents)}</td>
                        <td>{fmtDate(p.oldestAt)}</td>
                        <td><code className="cm-code">{p.stripeAccountId}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <div className="payouts-list-head" style={{ marginTop: '0.6rem' }}>Holding · {plan.held.length} · {dollars(plan.heldCents)}</div>
            {plan.held.length === 0 ? <p className="adm-empty">Nothing held.</p> : (
              <div className="cm-scroll">
                <table className="cm-table">
                  <thead><tr><th>Creator</th><th>Owed</th><th>Why</th></tr></thead>
                  <tbody>
                    {plan.held.map((h) => (
                      <tr key={h.creatorId}>
                        <td>{h.displayName}<span className="bk-email">{h.creatorId}</span></td>
                        <td>{dollars(h.cents)}</td>
                        <td>{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan.carry.length > 0 && (
              <p className="cm-sub" style={{ marginTop: '0.5rem' }}>
                {plan.carry.length} creator{plan.carry.length === 1 ? '' : 's'} with a zero or negative balance after reversals (carries into the next credits).
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Recent payouts</div>
        {recentPayouts.length === 0 ? <p className="adm-empty">No payouts yet.</p> : (
          <div className="cm-scroll">
            <table className="cm-table">
              <thead><tr><th>When</th><th>Creator</th><th>Period</th><th>Amount</th><th>Status</th><th>Transfer</th><th>By</th></tr></thead>
              <tbody>
                {recentPayouts.map((p) => {
                  const [label, cls] = PAYOUT_STATUS[p.status] || [p.status, 'transit'];
                  return (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.paidAt || p.createdAt)}</td>
                      <td>{p.displayName}<span className="bk-email">{p.creatorId}</span></td>
                      <td>{p.period}</td>
                      <td>{dollars(p.cents)}</td>
                      <td><span className={`payouts-pill ${cls}`}>{label}</span>{p.failedReason && <span className="bk-email">{p.failedReason}</span>}</td>
                      <td><code className="cm-code">{p.transferId || '—'}</code></td>
                      <td>{p.createdBy === 'cron' ? 'cron' : 'admin'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="payouts-fineprint" style={{ marginTop: '0.8rem' }}>
          A payout is one Stripe transfer (Connect) from the platform balance to the creator’s Express account; it then pays out to their bank on their own schedule. Tips and Pitch Room backing never come through here. Every run is in the audit log.
        </p>
      </div>
    </>
  );
}
