import { useCallback, useEffect, useState } from 'react';
import { dollars } from '../../lib/artistSupportRules';
import { applyBalance, earliestEffective, normalizeShareNumbers, shareChanges } from '../../lib/creatorShareRules';
import { STRIPE_FEE_FIXED_CENTS, STRIPE_FEE_PERCENT } from '../../lib/donationMath';

// /admin/creator-money: what Creator Share's ledger holds this month, who
// the next payout batch would pay and hold, the platform's Stripe balance
// it would draw on, the button that runs it now, and recent payouts.
// Reads and runs through /api/admin/creator-money (full admins only).
// `apiPath` exists for local dev pages.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

const PAYOUT_STATUS = { paid: ['Paid', 'paid'], pending: ['Pending', 'transit'], failed: ['Failed', 'failed'] };
const EMPTY_FORM = { creator: '', action: 'hold', reason: '', dollars: '', note: '', leaving: 'withdrew' };
const TIERS = [['standard', 'Standard'], ['premium', 'Premium'], ['sponsor', 'Sponsor']];
const toDollars = (cents) => (Number(cents || 0) / 100).toFixed(2);
const toCents = (v) => Math.round(Number(v) * 100);
const numbersForm = (n) => ({
  share: Object.fromEntries(TIERS.map(([t]) => [t, toDollars(n.shareCents[t])])),
  bonus: Object.fromEntries(TIERS.map(([t]) => [t, toDollars(n.bonusCents[t])])),
  minimum: toDollars(n.payoutMinimumCents),
  months: String(n.referralBonusMonths),
  ads: String(n.adSharePercent == null ? 50 : n.adSharePercent),
  effective: ''
});
const formNumbers = (f) => ({
  shareCents: Object.fromEntries(TIERS.map(([t]) => [t, toCents(f.share[t])])),
  bonusCents: Object.fromEntries(TIERS.map(([t]) => [t, toCents(f.bonus[t])])),
  payoutMinimumCents: toCents(f.minimum),
  referralBonusMonths: f.months,
  adSharePercent: f.ads
});

export default function CreatorMoneyPanel({ apiPath = '/api/admin/creator-money' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [nums, setNums] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiPath);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load Creator Share.');
      setData(d);
      if (d.numbers) setNums(numbersForm(d.numbers));
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

  // Holds and departures (Terms section 5; lib/creatorStanding.js).
  async function act(action, payload, label) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That didn’t work.');
      if (label) setNotice(label(d));
      await load();
      return d;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function holdRow(creatorId, name) {
    const reason = window.prompt(`Hold ${name}'s payouts for up to 90 days?\n\nWhy (kept on the record; they get a general message):`);
    if (reason && reason.trim()) act('hold', { creator: creatorId, reason }, () => `${name}'s payouts are on hold.`);
  }

  function extendRow(st) {
    const until = window.prompt(`Give ${st.displayName} until which date to collect? (YYYY-MM-DD)`, (st.collectUntil || '').slice(0, 10));
    if (until) act('extend', { creator: st.creatorId, until }, () => `${st.displayName} now has until ${fmtDate(until)}.`);
  }

  function submitForm(e) {
    e.preventDefault();
    const name = form.creator.trim();
    if (form.action === 'hold') {
      act('hold', { creator: name, reason: form.reason }, () => 'Payouts held for up to 90 days; the creator was told.').then((d) => { if (d) setForm(EMPTY_FORM); });
    } else if (form.action === 'cancel') {
      const cents = Math.round(Number(form.dollars) * 100);
      if (!window.confirm(`Cancel ${dollars(cents)} of ${name}'s credits?\n\nA negative line goes on their ledger; if they've already been paid, it comes out of their future credits.`)) return;
      act('cancel', { creator: name, cents, note: form.note }, () => `${dollars(cents)} cancelled.`).then((d) => { if (d) setForm(EMPTY_FORM); });
    } else {
      if (!window.confirm(`Mark ${name} as leaving?\n\nNo new credits from today. They have 90 days to collect what they earned (paid in full, even under the minimum); after that it moves to the site-wide pool.`)) return;
      act('leave', { creator: name, reason: form.leaving, note: form.note }, () => 'Marked as leaving; the creator was told how to collect.').then((d) => { if (d) setForm(EMPTY_FORM); });
    }
  }

  function saveNumbers(e) {
    e.preventDefault();
    const { numbers, errors } = normalizeShareNumbers(formNumbers(nums));
    if (errors.length) { setError(errors.join(' ')); return; }
    const changes = shareChanges(data.numbers, numbers);
    const lines = [...changes.adverse, ...changes.favourable].join('\n');
    const when = nums.effective ? `from ${fmtDate(nums.effective)}` : changes.adverse.length ? `from ${fmtDate(earliestEffective(data.numbers, numbers))} (30 days' notice)` : 'now';
    if (!window.confirm(`Change Creator Share ${when}?\n\n${lines}\n\nThe Terms page updates today. Creators get a notification${changes.adverse.length ? ' and an email' : ''}.`)) return;
    act('numbers', { numbers: formNumbers(nums), effectiveAt: nums.effective ? new Date(`${nums.effective}T09:00:00Z`).toISOString() : null }, (d) => (d.applied ? 'New numbers are in force.' : `Scheduled for ${fmtDate(d.effectiveAt)}.`) + ` ${d.notified} creator${d.notified === 1 ? '' : 's'} notified${d.emailed ? `, ${d.emailed} emailed` : ''}.`);
  }

  if (error && !data) return <p className="rq-error">{error}</p>;
  if (!data) return <p className="adm-empty">Loading…</p>;

  const { summary, plan, balance, recentPayouts } = data;
  const standings = data.standings || [];
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
            {data.adShare && data.adShare.available && (
              <div className="cm-sub" id="cm-ad-share">
                Ads inside titles this month so far: {Number(data.adShare.impressions).toLocaleString('en-US')} play{data.adShare.impressions === 1 ? '' : 's'} in {data.adShare.titles} title{data.adShare.titles === 1 ? '' : 's'} · {dollars(data.adShare.creditCents)} of advertiser credit served · up to {dollars(data.adShare.shareCents)} for creators at {data.numbers ? data.numbers.adSharePercent : 50}% (podcasts and studio-owned titles earn nothing), credited by the batch on the 1st.
              </div>
            )}
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
            {result.forfeited && result.forfeited.filter((f) => f.cents > 0).length > 0 && <>Moved {dollars(result.forfeited.reduce((t, f) => t + f.cents, 0))} of uncollected credits to the pool. </>}
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
                  <thead><tr><th>Creator</th><th>Owed</th><th>Oldest credit</th><th>Stripe</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {plan.pay.map((p) => (
                      <tr key={p.creatorId}>
                        <td>{p.displayName}<span className="bk-email">{p.creatorId}</span>{p.leaving && <span className="bk-email">left · paid in full</span>}</td>
                        <td>{dollars(p.cents)}</td>
                        <td>{fmtDate(p.oldestAt)}</td>
                        <td><code className="cm-code">{p.stripeAccountId}</code></td>
                        <td><button type="button" className="rq-btn" disabled={busy === 'hold'} onClick={() => holdRow(p.creatorId, p.displayName)}>Hold</button></td>
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
                  <thead><tr><th>Creator</th><th>Owed</th><th>Why</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {plan.held.map((h) => (
                      <tr key={h.creatorId}>
                        <td>{h.displayName}<span className="bk-email">{h.creatorId}</span></td>
                        <td>{dollars(h.cents)}</td>
                        <td>{h.reason === 'on hold' ? `on hold until ${fmtDate(h.holdUntil)}` : h.reason}{h.leaving && <span className="bk-email">left · collect by {fmtDate(h.collectUntil)}</span>}</td>
                        <td>{h.reason !== 'on hold' && !h.leaving && <button type="button" className="rq-btn" disabled={busy === 'hold'} onClick={() => holdRow(h.creatorId, h.displayName)}>Hold</button>}</td>
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

      {nums && data.numbers && <NumbersCard data={data.numbers} nums={nums} setNums={setNums} busy={busy} onSave={saveNumbers} onCancel={() => { if (window.confirm('Cancel the scheduled change? Creators are told nothing changes.')) act('cancel_numbers', {}, () => 'Scheduled change cancelled.'); }} />}

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="account-eyebrow">Holds and departures</div>
        <p className="cm-sub">
          Terms section 5. A <b>hold</b> stops a creator’s payouts for up to 90 days while you look into fraud; it lapses on its own. <b>Cancel credits</b> takes back credits that weren’t earned (stolen or disputed cards, fake accounts, bots, paid picks); past what they’re owed, it comes out of future credits. A creator who <b>left</b> (withdrew their work, closed their account, suspended) gets no new credits and has 90 days to collect, paid in full even under {dollars(plan.minimumCents)}; then the next run moves the rest to the site-wide pool.
        </p>
        {notice && <p className="cm-result">{notice}</p>}
        {standings.length === 0 ? <p className="adm-empty">Every creator is in good standing.</p> : (
          <div className="cm-scroll">
            <table className="cm-table">
              <thead><tr><th>Creator</th><th>Owed</th><th>Standing</th></tr></thead>
              <tbody>
                {standings.map((st) => (
                  <tr key={st.creatorId}>
                    <td>{st.displayName}<span className="bk-email">{st.creatorId}</span></td>
                    <td>{dollars(Math.max(0, st.owedCents))}</td>
                    <td>
                      {st.held && <div><span className="payouts-pill failed">On hold</span> until {fmtDate(st.holdUntil)}{st.holdReason && <span className="bk-email">{st.holdReason}</span>}</div>}
                      {st.holdLapsed && !st.held && <div><span className="payouts-pill transit">Hold lapsed</span> {fmtDate(st.holdUntil)} · paid again from the next run</div>}
                      {st.leaving && (
                        <div style={{ marginTop: st.held ? '0.3rem' : 0 }}>
                          <span className={`payouts-pill ${st.forfeitedAt ? 'paid' : st.expired ? 'failed' : 'transit'}`}>{st.forfeitedAt ? 'Moved to pool' : st.expired ? '90 days up' : 'Left'}</span>{' '}
                          {st.leavingReason} {fmtDate(st.leftAt)}
                          <span className="bk-email">{st.forfeitedAt ? `${dollars(st.forfeitedCents || 0)} to the pool on ${fmtDate(st.forfeitedAt)}` : `collect by ${fmtDate(st.collectUntil)}`}</span>
                          {st.note && <span className="bk-email">{st.note}</span>}
                          {!st.forfeitedAt && st.remindersSent && st.remindersSent.length > 0 && <span className="bk-email">reminded at {[...st.remindersSent].sort((a, b) => b - a).join(', ')} days</span>}
                        </div>
                      )}
                      <div className="cm-actions">
                      {st.held && <button type="button" className="rq-btn" disabled={Boolean(busy)} onClick={() => act('release', { creator: st.creatorId }, () => `${st.displayName}'s payouts are back on.`)}>Release</button>}
                      {st.leaving && !st.forfeitedAt && <button type="button" className="rq-btn" disabled={Boolean(busy)} onClick={() => extendRow(st)}>Extend</button>}
                      {st.expired && <button type="button" className="rq-btn" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Move ${st.displayName}'s ${dollars(Math.max(0, st.owedCents))} to the site-wide pool now?`)) act('forfeit', { creator: st.creatorId }, () => 'Moved to the site-wide pool.'); }}>Move to pool</button>}
                      {st.leaving && <button type="button" className="rq-btn" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Put ${st.displayName} back in good standing? New credits resume.${st.forfeitedAt ? ' What already went to the pool stays there.' : ''}`)) act('unleave', { creator: st.creatorId }, () => `${st.displayName} is back in good standing.`); }}>Back in good standing</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="sm-form" onSubmit={submitForm}>
          <label><span>Creator</span><input id="cm-st-creator" className="sm-input" value={form.creator} onChange={(e) => setForm({ ...form, creator: e.target.value })} placeholder="@handle or user_…" required /></label>
          <label><span>Action</span>
            <select id="cm-st-action" className="sm-input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              <option value="hold">Hold payouts (90 days)</option>
              <option value="cancel">Cancel credits</option>
              <option value="leave">Mark as leaving</option>
            </select>
          </label>
          {form.action === 'hold' && (
            <label className="sm-wide"><span>Why (for the record)</span><input id="cm-st-reason" className="sm-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="3 disputed memberships through their link this week" required /></label>
          )}
          {form.action === 'cancel' && (
            <>
              <label><span>Amount ($)</span><input id="cm-st-amount" className="sm-input" type="number" min="0.01" step="0.01" value={form.dollars} onChange={(e) => setForm({ ...form, dollars: e.target.value })} required /></label>
              <label className="sm-wide"><span>Why (goes on the ledger line)</span><input id="cm-st-note" className="sm-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="stolen-card memberships, Oct 3–9" required /></label>
            </>
          )}
          {form.action === 'leave' && (
            <>
              <label><span>Why they left</span>
                <select id="cm-st-leaving" className="sm-input" value={form.leaving} onChange={(e) => setForm({ ...form, leaving: e.target.value })}>
                  <option value="withdrew">Withdrew their work</option>
                  <option value="closed">Closed their account</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              <label className="sm-wide"><span>Note</span><input id="cm-st-note" className="sm-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="optional, e.g. working on a new cut" /></label>
            </>
          )}
          <div className="sm-form-actions"><button type="submit" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={Boolean(busy)}>{busy && busy !== 'run' ? 'Saving…' : form.action === 'hold' ? 'Hold payouts' : form.action === 'cancel' ? 'Cancel credits' : 'Mark as leaving'}</button></div>
        </form>
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
                      <td><span className={`payouts-pill ${cls}`}>{label}</span>{p.reversedCents > 0 && <span className="bk-email">{dollars(p.reversedCents)} reversed in Stripe · owed again</span>}{p.failedReason && <span className="bk-email">{p.failedReason}</span>}</td>
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
          A payout is one Stripe transfer (Connect) from the platform balance to the creator’s Express account; it then pays out to their bank on their own schedule. Reversing a transfer in the Stripe dashboard puts that amount back on the creator’s balance (the transfer.reversed webhook); hold or cancel it here if it shouldn’t be paid again. Tips and Pitch Room backing never come through here. Every run is in the audit log.
        </p>
      </div>
    </>
  );
}

// The Creator Share numbers: what each paid membership shares, the
// referral bonus, the payout minimum and how long the bonus lasts. What
// the studio keeps per tier is the price less the share, the bonus and
// Stripe's card fee. A change against creators can only be scheduled 30
// days out (lib/creatorShareRules.js earliestEffective).
function NumbersCard({ data, nums, setNums, busy, onSave, onCancel }) {
  const typed = formNumbers(nums);
  const { numbers, errors } = normalizeShareNumbers(typed);
  const changes = errors.length ? { adverse: [], favourable: [], changed: false } : shareChanges(data, numbers);
  const earliest = changes.adverse.length ? earliestEffective(data, numbers) : null;
  const set = (group, tier, value) => setNums({ ...nums, [group]: { ...nums[group], [tier]: value } });
  const fee = (price) => Math.round((price * STRIPE_FEE_PERCENT) / 100) + STRIPE_FEE_FIXED_CENTS;
  const sched = data.scheduled;
  return (
    <div className="account-card" style={{ marginBottom: '1rem' }}>
      <div className="adm-card-head">
        <div className="account-eyebrow" style={{ marginBottom: 0 }}>Creator Share numbers</div>
        {data.changedAt && <span className="cm-sub">last changed {fmtDate(data.changedAt)}</span>}
      </div>
      <p className="cm-sub">
        What every paid membership shares with creators each month, the referral bonus, the ad share (credited on the 1st for the month before, by the title each ad played in; podcasts, house ads and studio-owned titles earn nothing), and when payouts go out. The Terms page (sections 4 and 5) always shows these numbers. A change that pays creators less takes effect 30 days after you save it at the earliest, and creators get an email; anything in their favour can start today.
      </p>
      {!data.migrated && <p className="rq-error">Migration 088 hasn’t been run, so these are the built-in defaults and can’t be saved yet.</p>}
      {sched && (
        <div className="cm-sched">
          <b>Scheduled for {fmtDate(sched.effectiveAt)}</b>
          <span>{[...(sched.adverse || []), ...(sched.favourable || [])].join(' · ')}</span>
          <button type="button" className="rq-btn" disabled={Boolean(busy)} onClick={onCancel}>Cancel change</button>
        </div>
      )}
      <form onSubmit={onSave}>
        <div className="cm-scroll">
          <table className="cm-table cm-numbers">
            <thead><tr><th>Tier</th><th>Price</th><th>Member share</th><th>Referral bonus</th><th>Studio keeps</th></tr></thead>
            <tbody>
              {TIERS.map(([t, label]) => {
                const price = data.prices ? data.prices[t] : null;
                const keeps = price ? price - numbers.shareCents[t] - numbers.bonusCents[t] - fee(price) : null;
                return (
                  <tr key={t}>
                    <td><b>{label}</b></td>
                    <td>{price ? dollars(price) : '—'}</td>
                    <td><input id={`cm-n-share-${t}`} className="sm-input" type="number" min="0" step="0.01" value={nums.share[t]} onChange={(e) => set('share', t, e.target.value)} /></td>
                    <td><input id={`cm-n-bonus-${t}`} className="sm-input" type="number" min="0" step="0.01" value={nums.bonus[t]} onChange={(e) => set('bonus', t, e.target.value)} /></td>
                    <td>{keeps == null ? '—' : <span className={keeps < 0 ? 'cm-neg' : ''}>{dollars(keeps)}</span>}<span className="bk-email">with a referral, after the card fee</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sm-form">
          <label><span>Payout minimum ($)</span><input id="cm-n-minimum" className="sm-input" type="number" min="1" step="0.01" value={nums.minimum} onChange={(e) => setNums({ ...nums, minimum: e.target.value })} /></label>
          <label><span>Bonus paid for (months, 0 = no limit)</span><input id="cm-n-months" className="sm-input" type="number" min="0" max="120" step="1" value={nums.months} onChange={(e) => setNums({ ...nums, months: e.target.value })} /></label>
          <label><span>Ad share (% of what advertisers paid for ads inside a title)</span><input id="cm-n-ads" className="sm-input" type="number" min="0" max="100" step="1" value={nums.ads} onChange={(e) => setNums({ ...nums, ads: e.target.value })} /></label>
          <label><span>Takes effect (optional)</span><input id="cm-n-effective" className="sm-input" type="date" value={nums.effective} onChange={(e) => setNums({ ...nums, effective: e.target.value })} /></label>
          <div className="sm-form-actions"><button type="submit" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={Boolean(busy) || !changes.changed || errors.length > 0}>{busy === 'numbers' ? 'Saving…' : earliest || nums.effective ? 'Schedule change' : 'Save numbers'}</button></div>
        </div>
        {errors.length > 0 && <p className="rq-error">{errors.join(' ')}</p>}
        {changes.adverse.length > 0 && (
          <p className="cm-sub cm-warn">Pays creators less ({changes.adverse.join('; ')}): takes effect {fmtDate(earliest)} at the earliest, and every creator with released work gets an email today.</p>
        )}
        {changes.favourable.length > 0 && changes.adverse.length === 0 && (
          <p className="cm-sub">In creators’ favour ({changes.favourable.join('; ')}): can start today.</p>
        )}
      </form>
    </div>
  );
}
