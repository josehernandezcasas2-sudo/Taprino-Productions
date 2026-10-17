import { useCallback, useEffect, useState } from 'react';
import { dollars, SWEEP_MODES } from '../../lib/studioMoneyRules';

// /admin/money (mockups/studio-money-v1.html): the Stripe balance, what
// has to stay, what can leave, the sweep, the rules, earmarks, the
// reconciliation with its explanations, the studio's share and the
// tax-season card. Reads and acts through /api/admin/money (full admins).
// `apiPath` exists for local dev pages.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const signed = (cents) => (cents > 0 ? `+${dollars(cents)}` : dollars(cents));

const SWEEP_STATUS = { paid: ['Arrived', 'paid'], in_transit: ['In transit', 'transit'], pending: ['Pending', 'transit'], failed: ['Failed', 'failed'], canceled: ['Cancelled', 'failed'] };

function Amount({ cents, tone }) {
  const cls = tone || (cents < 0 ? 'neg' : cents > 0 ? 'pos' : '');
  return <span className={`sm-amt ${cls}`}>{signed(cents)}</span>;
}

export default function StudioMoneyPanel({ apiPath = '/api/admin/money' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [earmark, setEarmark] = useState({ label: '', dollars: '', note: '' });
  const [explain, setExplain] = useState({ dollars: '', explanation: '' });
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiPath);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load Studio money.');
      setData(d);
      setSettings({
        sweepDay: d.settings.sweepDay,
        sweepMode: d.settings.sweepMode,
        reservePercent: d.settings.reservePercent,
        reserveDays: d.settings.reserveDays,
        reserveFloor: (d.settings.reserveFloorCents / 100).toFixed(2),
        toleranceDollars: (d.settings.toleranceCents / 100).toFixed(2),
        tolerancePercent: d.settings.tolerancePercent
      });
    } catch (err) {
      setError(err.message);
    }
  }, [apiPath]);
  useEffect(() => { load(); }, [load]);

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

  function sweep() {
    if (!data) return;
    const ok = window.confirm(
      `Send ${dollars(data.canLeave.cents)} to the bank now?\n\n` +
      `Stays in Stripe: ${dollars(data.canLeave.stayCents)} (creators ${dollars(data.obligations.owedCents)}, advertisers ${dollars(data.obligations.adCreditsCents)}, reserve ${dollars(data.obligations.reserve.cents)}, earmarks ${dollars(data.obligations.earmarkCents)}).\n\n` +
      'This creates one Stripe payout to the studio’s bank and closes this period. It can’t be undone from here.'
    );
    if (!ok) return;
    act('sweep', {}, (d) => `${dollars(d.sweep.cents)} is on its way (payout ${d.sweep.payoutId}${d.sweep.arrivalOn ? `, arriving ${fmtDay(d.sweep.arrivalOn)}` : ''}).`);
  }

  function addEarmark(e) {
    e.preventDefault();
    const cents = Math.round(Number(earmark.dollars) * 100);
    act('earmark', { label: earmark.label, cents, note: earmark.note }, () => 'Earmark added.').then((d) => { if (d) setEarmark({ label: '', dollars: '', note: '' }); });
  }

  function addExplanation(e) {
    e.preventDefault();
    const cents = Math.round(Number(explain.dollars) * 100);
    act('explain', { cents, explanation: explain.explanation }, () => 'Explanation saved.').then((d) => { if (d) setExplain({ dollars: '', explanation: '' }); });
  }

  function saveSettings(e) {
    e.preventDefault();
    act('settings', {
      settings: {
        sweepDay: Number(settings.sweepDay),
        sweepMode: settings.sweepMode,
        reservePercent: Number(settings.reservePercent),
        reserveDays: Number(settings.reserveDays),
        reserveFloorCents: Math.round(Number(settings.reserveFloor) * 100),
        toleranceCents: Math.round(Number(settings.toleranceDollars) * 100),
        tolerancePercent: Number(settings.tolerancePercent)
      }
    }, () => 'Rules saved.');
  }

  if (error && !data) return <p className="rq-error">{error}</p>;
  if (!data) return <p className="adm-empty">Reading Stripe and the ledger…</p>;

  const { stripe, obligations, canLeave, sweep: sw, reconciliation: rec, studioShare: share, tax } = data;
  const scheduleOk = stripe.scheduleInterval === 'manual';
  const sinceLabel = `${fmtDay(rec.since)} → ${fmtDay(rec.until)}`;
  const m = share.membership;

  return (
    <>
      {!data.available && <p className="rq-error">Migration 089 hasn’t been run: the page reads what it can, but sweeps, earmarks and explanations can’t be saved yet.</p>}
      {!stripe.configured && <p className="rq-error">Stripe isn’t configured on this deployment, so the balance and the reconciliation are empty.</p>}
      {stripe.configured && !stripe.ok && <p className="rq-error">Stripe couldn’t be read{stripe.error ? `: ${stripe.error}` : ''}. The numbers below are from our tables only.</p>}

      <div className="adm-stats cm-stats">
        <div className="adm-stat"><b>{dollars(stripe.availableCents)}</b><span>available in Stripe</span></div>
        <div className="adm-stat"><b>{dollars(stripe.pendingCents)}</b><span>pending · never counted</span></div>
        <div className={`adm-stat${scheduleOk ? '' : ' sm-bad'}`}><b>{stripe.scheduleInterval || '—'}</b><span>Stripe payout schedule{scheduleOk ? '' : ' · must be manual'}</span></div>
        <div className="adm-stat"><b>{dollars(obligations.owedCents)}</b><span>owed to creators</span></div>
        <div className="adm-stat"><b>{dollars(canLeave.stayCents)}</b><span>has to stay</span></div>
        <div className="adm-stat sm-hot"><b>{dollars(canLeave.cents)}</b><span>can leave to the bank</span></div>
      </div>

      {notice && <p className="sm-notice">{notice}</p>}
      {error && <p className="rq-error">{error}</p>}

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="cm-cols">
          <div>
            <div className="account-eyebrow">How it’s worked out</div>
            <table className="sm-ledger">
              <tbody>
                <tr><td className="op" /><td>Available in Stripe<span className="sm-sub">Stripe balance · pending money is never counted</span></td><td>{dollars(stripe.availableCents)}</td></tr>
                <tr><td className="op">−</td><td>Owed to creators<span className="sm-sub">Creator Share ledger, unpaid lines · {obligations.owedCreators} creator{obligations.owedCreators === 1 ? '' : 's'}</span></td><td className="neg">{dollars(obligations.owedCents)}</td></tr>
                <tr><td className="op">−</td><td>Advertisers’ credits not yet served<span className="sm-sub">prepaid, refundable until the impressions run</span></td><td className="neg">{dollars(obligations.adCreditsCents)}</td></tr>
                <tr><td className="op">−</td><td>Refund &amp; dispute reserve<span className="sm-sub">{obligations.reserve.percent}% of the last {obligations.reserve.days} days’ card volume ({dollars(obligations.reserve.volumeCents)}), floor {dollars(obligations.reserve.floorCents)}</span></td><td className="neg">{dollars(obligations.reserve.cents)}</td></tr>
                <tr><td className="op">−</td><td>Earmarked for films and matches<span className="sm-sub">{obligations.earmarks.length} earmark{obligations.earmarks.length === 1 ? '' : 's'}, below · the studio’s own money kept in Stripe on purpose</span></td><td className="neg">{dollars(obligations.earmarkCents)}</td></tr>
                <tr className="total"><td className="op">=</td><td>Can leave to the bank{canLeave.shortfallCents > 0 && <span className="sm-sub">the balance is {dollars(canLeave.shortfallCents)} short of what has to stay</span>}</td><td>{dollars(canLeave.cents)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <div className="account-eyebrow">The sweep</div>
            <div className="sm-kv"><span>Next sweep</span><b>{fmtDate(sw.nextOn)} · {sw.mode === 'auto' ? 'automatic' : 'confirm mode'}{sw.isToday ? ' · today' : ''}</b></div>
            <div className="sm-kv"><span>Last sweep</span><b>{sw.last ? `${fmtDate(sw.last.createdAt)} · ${dollars(sw.last.cents)}` : 'none yet'}</b></div>
            <div style={{ margin: '0.9rem 0 0.5rem' }}>
              <button type="button" className="account-btn-primary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy === 'sweep' || !sw.gate.ok} onClick={sweep}>
                {busy === 'sweep' ? 'Sending…' : `Send ${dollars(canLeave.cents)} to the bank →`}
              </button>
            </div>
            {!sw.gate.ok && (
              <ul className="sm-reasons">
                {sw.gate.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="cm-sub" style={{ marginTop: '0.6rem' }}>
              One Stripe payout to the studio’s bank, about two business days to arrive. The calculation above is frozen into the sweep, and this period’s explanations close with it.
            </p>
            {sw.history.length > 0 && (
              <>
                <div className="payouts-list-head">Sweep history</div>
                <div className="cm-scroll">
                  <table className="cm-table">
                    <thead><tr><th>Date</th><th>Sent</th><th>Status</th><th>Arrives</th><th>Difference then</th><th>Note</th></tr></thead>
                    <tbody>
                      {sw.history.map((s) => {
                        const [label, cls] = SWEEP_STATUS[s.status] || [s.status, 'transit'];
                        return (
                          <tr key={s.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.createdAt)}</td>
                            <td>{dollars(s.cents)}</td>
                            <td><span className={`payouts-pill ${cls}`}>{label}</span>{s.failedReason && <span className="bk-email">{s.failedReason}</span>}</td>
                            <td>{s.arrivalOn ? fmtDay(`${s.arrivalOn}T12:00:00Z`) : '—'}</td>
                            <td>{dollars(s.discrepancyCents)}</td>
                            <td>{s.note || (s.createdBy === 'cron' ? 'automatic' : '')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {stripe.recentPayouts.some((p) => !p.ours) && (
              <p className="cm-sub" style={{ marginTop: '0.6rem' }}>
                Stripe also shows payouts not made from this page: {stripe.recentPayouts.filter((p) => !p.ours).slice(0, 3).map((p) => `${dollars(p.cents)} on ${fmtDay(p.createdAt)}${p.automatic ? ' (automatic)' : ''}`).join(', ')}.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="account-eyebrow">Rules &amp; schedule</div>
        <form className="sm-form" onSubmit={saveSettings}>
          <label><span>Sweep day of the month</span><input id="sm-day" className="sm-input" type="number" min="1" max="28" value={settings.sweepDay} onChange={(e) => setSettings({ ...settings, sweepDay: e.target.value })} /></label>
          <label><span>Mode</span>
            <select id="sm-mode" className="sm-input" value={settings.sweepMode} onChange={(e) => setSettings({ ...settings, sweepMode: e.target.value })}>
              {SWEEP_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'auto' ? 'automatic (the cron sends it)' : 'confirm (you press the button)'}</option>)}
            </select>
          </label>
          <label><span>Reserve · % of card volume</span><input id="sm-reserve-pct" className="sm-input" type="number" min="0" max="100" step="0.5" value={settings.reservePercent} onChange={(e) => setSettings({ ...settings, reservePercent: e.target.value })} /></label>
          <label><span>Reserve · days of volume</span><input id="sm-reserve-days" className="sm-input" type="number" min="1" max="365" value={settings.reserveDays} onChange={(e) => setSettings({ ...settings, reserveDays: e.target.value })} /></label>
          <label><span>Reserve · floor ($)</span><input id="sm-reserve-floor" className="sm-input" type="number" min="0" step="0.01" value={settings.reserveFloor} onChange={(e) => setSettings({ ...settings, reserveFloor: e.target.value })} /></label>
          <label><span>Tolerance · unexplained ($)</span><input id="sm-tol" className="sm-input" type="number" min="0" step="0.01" value={settings.toleranceDollars} onChange={(e) => setSettings({ ...settings, toleranceDollars: e.target.value })} /></label>
          <label><span>Tolerance · % of the period</span><input id="sm-tol-pct" className="sm-input" type="number" min="0" max="100" step="0.1" value={settings.tolerancePercent} onChange={(e) => setSettings({ ...settings, tolerancePercent: e.target.value })} /></label>
          <div className="sm-form-actions">
            <button type="submit" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy === 'settings'}>{busy === 'settings' ? 'Saving…' : 'Save rules'}</button>
          </div>
        </form>
        <p className="cm-sub" style={{ marginTop: '0.6rem' }}>
          The creator batch runs on the 1st; the sweep on the {sw.day}{sw.day === 1 ? 'st' : sw.day === 2 ? 'nd' : sw.day === 3 ? 'rd' : 'th'} leaves it time to settle. Over the tolerance, the sweep waits for a human whatever the mode.
        </p>
      </div>

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="account-eyebrow">Earmarks · {dollars(obligations.earmarkCents)}</div>
        <p className="cm-sub">A named amount of the studio’s own money that the sweep leaves in Stripe. It never changes what creators are owed; release it when the film is paid for.</p>
        {obligations.earmarks.length === 0 ? <p className="adm-empty">No earmarks.</p> : (
          <div className="cm-scroll">
            <table className="cm-table">
              <thead><tr><th>Earmark</th><th>Amount</th><th>Added</th><th>Note</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {obligations.earmarks.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.label}</b></td>
                    <td>{dollars(e.cents)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.createdAt)}</td>
                    <td>{e.note || ''}</td>
                    <td><button type="button" className="rq-btn" disabled={busy === 'release'} onClick={() => { if (window.confirm(`Release “${e.label}” (${dollars(e.cents)})? It no longer stays in Stripe.`)) act('release', { id: e.id }, () => 'Earmark released.'); }}>Release</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="sm-form sm-form-inline" onSubmit={addEarmark}>
          <label><span>Label</span><input id="sm-earmark-label" className="sm-input" value={earmark.label} onChange={(e) => setEarmark({ ...earmark, label: e.target.value })} placeholder="Film fund · The Salt Hours finishing" required /></label>
          <label><span>Amount ($)</span><input id="sm-earmark-amount" className="sm-input" type="number" min="0.01" step="0.01" value={earmark.dollars} onChange={(e) => setEarmark({ ...earmark, dollars: e.target.value })} required /></label>
          <label><span>Note</span><input id="sm-earmark-note" className="sm-input" value={earmark.note} onChange={(e) => setEarmark({ ...earmark, note: e.target.value })} placeholder="optional" /></label>
          <div className="sm-form-actions"><button type="submit" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy === 'earmark'}>{busy === 'earmark' ? 'Adding…' : 'Add earmark'}</button></div>
        </form>
      </div>

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="adm-card-head">
          <div className="account-eyebrow" style={{ marginBottom: 0 }}>Reconciliation · {sinceLabel}</div>
          <span className={`payouts-pill ${rec.withinTolerance ? 'paid' : 'failed'}`}>{rec.withinTolerance ? 'within tolerance' : 'over tolerance'}</span>
        </div>
        <p className="cm-sub">Stripe’s balance transactions since the last sweep ({rec.transactions}{rec.capped ? '+' : ''}), grouped, next to what our tables say. Differences come from real things: a card that cost more than the fee cover, a Stripe adjustment, a payout made by hand. They never vanish into the studio’s share.</p>
        {rec.rows.length === 0 ? <p className="adm-empty">Nothing moved in this period.</p> : (
          <div className="cm-scroll">
            <table className="cm-table">
              <thead><tr><th>Lane</th><th>Stripe</th><th>Net to balance</th><th>Our records</th><th>Expected</th><th>Difference</th></tr></thead>
              <tbody>
                {rec.rows.map((r) => (
                  <tr key={r.key}>
                    <td><b>{r.label}</b></td>
                    <td>{r.stripe.count} transaction{r.stripe.count === 1 ? '' : 's'}{r.stripe.feeCents ? ` · fees ${dollars(r.stripe.feeCents)}` : ''}{r.stripe.unmatchedCount ? <span className="bk-email">{r.stripe.unmatchedCount} not in our tables ({signed(r.stripe.unmatchedCents)})</span> : null}</td>
                    <td><Amount cents={r.stripe.netCents} /></td>
                    <td>{r.records.count} record{r.records.count === 1 ? '' : 's'}{r.records.cutCents ? ` · cut ${dollars(r.records.cutCents)}` : r.records.cents ? ` · ${dollars(r.records.cents)}` : ''}</td>
                    <td><Amount cents={r.expectedCents} /></td>
                    <td><Amount cents={r.differenceCents} tone={r.differenceCents === 0 ? 'zero' : 'neg'} /></td>
                  </tr>
                ))}
                <tr className="sm-sum"><td>Period</td><td /><td><Amount cents={rec.stripeNetCents} /></td><td /><td><Amount cents={rec.expectedCents} /></td><td><Amount cents={rec.differenceCents} tone={rec.differenceCents === 0 ? 'zero' : 'neg'} /></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="cm-cols" style={{ marginTop: '1rem' }}>
          <div>
            <div className="account-eyebrow">Difference this period</div>
            <table className="sm-ledger">
              <tbody>
                <tr><td className="op" /><td>Explained<span className="sm-sub">{rec.explanations.length === 0 ? 'nothing explained yet' : rec.explanations.map((x) => `${signed(x.cents)} ${x.explanation}`).join(' · ')}</span></td><td>{signed(rec.explainedCents)}</td></tr>
                <tr><td className="op" /><td>Unexplained<span className="sm-sub">tolerance {dollars(rec.toleranceCents)} · {rec.withinTolerance ? 'carries as a studio adjustment' : 'the sweep waits until this is explained'}</span></td><td className={rec.withinTolerance ? '' : 'neg'}>{signed(rec.unexplainedCents)}</td></tr>
                <tr className="total"><td className="op">=</td><td>Stripe minus our records</td><td>{signed(rec.differenceCents)}</td></tr>
              </tbody>
            </table>
            {rec.unmatched.length > 0 && (
              <>
                <div className="payouts-list-head">Not in our tables</div>
                <ul className="sm-unmatched">
                  {rec.unmatched.map((u) => <li key={u.id}><b>{signed(u.cents)}</b> · {u.lane} · {u.why}{u.description ? ` · ${u.description}` : ''}{u.created ? ` · ${fmtDay(new Date(u.created * 1000).toISOString())}` : ''}</li>)}
                </ul>
              </>
            )}
          </div>
          <div>
            <div className="account-eyebrow">Explain a difference</div>
            <form className="sm-form" onSubmit={addExplanation}>
              <label><span>Amount ($, negative when Stripe has less)</span><input id="sm-explain-amount" className="sm-input" type="number" step="0.01" value={explain.dollars} onChange={(e) => setExplain({ ...explain, dollars: e.target.value })} placeholder={(rec.unexplainedCents / 100).toFixed(2)} required /></label>
              <label className="sm-wide"><span>What it is</span><textarea id="sm-explain-text" className="sm-input" rows={3} value={explain.explanation} onChange={(e) => setExplain({ ...explain, explanation: e.target.value })} placeholder="Oct 29 adjustment: Stripe reversed a Radar fee credit from September. Checked in Dashboard → Balance." required /></label>
              <div className="sm-form-actions"><button type="submit" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} disabled={busy === 'explain'}>{busy === 'explain' ? 'Saving…' : 'Save explanation'}</button></div>
            </form>
            <p className="cm-sub" style={{ marginTop: '0.5rem' }}>Stored with your name on the period and closed by the next sweep. Explained differences don’t count toward the tolerance.</p>
          </div>
        </div>
      </div>

      <div className="account-card" style={{ marginBottom: '1rem' }}>
        <div className="account-eyebrow">The studio’s share · {sinceLabel}</div>
        <div className="cm-cols" style={{ marginTop: '0.4rem' }}>
          <div>
            <div className="sm-sub" style={{ marginBottom: 4 }}>Memberships · {dollars(m.grossCents)} gross</div>
            {m.grossCents > 0 && (
              <>
                <div className="sm-bar" aria-hidden="true">
                  <div style={{ width: `${m.split.fees}%`, background: 'var(--ink-faint)' }} />
                  <div style={{ width: `${m.split.creators}%`, background: 'var(--olive)' }} />
                  <div style={{ width: `${m.split.loss}%`, background: 'var(--danger)' }} />
                  <div style={{ width: `${Math.max(0, m.split.studio)}%`, background: 'var(--mint, #93d0a4)' }} />
                </div>
                <div className="sm-legend">
                  <span><i style={{ background: 'var(--ink-faint)' }} />Stripe fees {dollars(m.feeCents)}</span>
                  <span><i style={{ background: 'var(--olive)' }} />Creators {dollars(m.creditedCents)}</span>
                  <span><i style={{ background: 'var(--danger)' }} />Refunds &amp; disputes {dollars(m.lossCents)}</span>
                  <span><i style={{ background: 'var(--mint, #93d0a4)' }} />Studio {dollars(m.marginCents)}</span>
                </div>
              </>
            )}
            <table className="sm-ledger" style={{ marginTop: '0.6rem' }}>
              <tbody>
                <tr><td className="op" /><td>Membership revenue</td><td>{dollars(m.grossCents)}</td></tr>
                <tr><td className="op">−</td><td>Stripe fees<span className="sm-sub">as charged</span></td><td className="neg">{dollars(m.feeCents)}</td></tr>
                <tr><td className="op">−</td><td>Creator Share credited<span className="sm-sub">member shares and referral bonuses · {m.split.creators}% of gross</span></td><td className="neg">{dollars(m.creditedCents)}</td></tr>
                <tr><td className="op">−</td><td>Refunds and disputes<span className="sm-sub">their credits were reversed; what’s left is the studio’s loss</span></td><td className="neg">{dollars(m.lossCents)}</td></tr>
                <tr className="total"><td className="op">=</td><td>Membership margin</td><td>{dollars(m.marginCents)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <table className="sm-ledger">
              <tbody>
                <tr><td className="op" /><td>Membership margin</td><td>{dollars(share.together.marginCents)}</td></tr>
                <tr><td className="op">+</td><td>Pitch Room cut kept<span className="sm-sub">after transfers and the fee gap</span></td><td className="pos">{dollars(share.together.backingKeptCents)}</td></tr>
                <tr><td className="op">+</td><td>Location cut kept</td><td className="pos">{dollars(share.together.bookingsKeptCents)}</td></tr>
                <tr><td className="op">+</td><td>Ads served<span className="sm-sub">impressions delivered · unserved credits stay a liability</span></td><td className="pos">{dollars(share.together.adsServedCents)}</td></tr>
                <tr><td className="op">−</td><td>Unexplained differences carried</td><td className="neg">{dollars(Math.max(0, -share.together.unexplainedCents))}</td></tr>
                <tr className="total"><td className="op">=</td><td>Studio share this period<span className="sm-sub">for maintenance and other projects · before the reserve and earmarks you keep in Stripe</span></td><td>{dollars(share.together.shareCents)}</td></tr>
              </tbody>
            </table>
            <p className="cm-sub" style={{ marginTop: '0.6rem' }}>An operating number, not a tax number: it ignores hosting and the other bills, and counts ad credits when served, not when bought. The accountant’s books start from Stripe’s balance-transaction export.</p>
          </div>
        </div>
      </div>

      <div className="account-card">
        <div className="account-eyebrow">Tax season · {tax.year}</div>
        <div className="cm-cols" style={{ marginTop: '0.4rem' }}>
          <div>
            <div className="adm-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: 0 }}>
              <div className="adm-stat"><b>{tax.paid}</b><span>creators paid this year</span></div>
              <div className="adm-stat"><b>{tax.over10}</b><span>over $10 · 1099-MISC royalties</span></div>
              <div className="adm-stat"><b>{tax.over600} · {tax.over2000}</b><span>over $600 · over $2,000 · 1099-NEC</span></div>
            </div>
            <p className="cm-sub" style={{ marginTop: '0.6rem' }}>Which threshold applies depends on whether the lawyer calls the member share a royalty for the licence (1099-MISC, $10) or a payment for services (1099-NEC). Both counts show until that’s answered.</p>
          </div>
          <div>
            <div className="sm-check ok"><span className="m">✓</span><span>Creators’ tax IDs are collected in Stripe Express onboarding<small>Stripe asks for an SSN or EIN before payouts are enabled</small></span></div>
            <div className="sm-check"><span className="m">·</span><span>Stripe Connect tax forms<small>Dashboard → Connect → Tax forms: choose the form and Stripe prepares and e-files for connected accounts. Do it before January.</small></span></div>
            <div className="sm-check ok"><span className="m">✓</span><span>Backing and bookings are destination charges<small>only the cut is studio income; the creator’s part passes through</small></span></div>
            <div className={`sm-check ${scheduleOk ? 'ok' : 'bad'}`}><span className="m">{scheduleOk ? '✓' : '✕'}</span><span>Platform payouts on manual<small>{scheduleOk ? 'the balance holds until the batch and the sweep' : 'Stripe still sweeps the balance on its own; set it to manual in Dashboard → Settings → Payouts'}</small></span></div>
          </div>
        </div>
      </div>
    </>
  );
}
