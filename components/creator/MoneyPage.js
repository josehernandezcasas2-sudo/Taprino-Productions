import { useEffect, useState } from 'react';
import Link from 'next/link';
import BackButton from '../BackButton';
import { SITE } from '../../lib/siteConfig';
import { LANES, LANE_ORDER, dollars, signed, periodLabel } from '../../lib/creatorMoneyRules';

// The body of the creator's Money page (pages/creator/money.js wraps it
// in the site chrome and the sign-in gate). Reads `apiPath`
// (/api/creator/money: lib/creatorMoney.js) for the chosen period, and
// `payoutsApiPath` for the Stripe Express dashboard link. Everything
// shown comes from the server; nothing here moves money.
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '');
const fmtDayOnly = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const LANE_LINKS = { member_support: '#supporters', ad_share: '#history', tips: '#history', sales: '/creator/my-work', backing: '/creator/pitch/dashboard', bookings: '/locations/mine' };
const LANE_LINK_TEXT = { member_support: 'Who supports you →', ad_share: 'Every title →', tips: 'Read the notes →', sales: 'Prices and sales →', backing: 'Your pitches →', bookings: 'Your places →' };

function Row({ label, value }) {
  return <span className="money-row"><span>{label}</span><b>{value}</b></span>;
}

export default function MoneyPage({ apiPath = '/api/creator/money', payoutsApiPath = '/api/creator/payouts' }) {
  const [period, setPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [stripeBusy, setStripeBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [noteBusy, setNoteBusy] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiPath}${period ? `${apiPath.includes('?') ? '&' : '?'}period=${encodeURIComponent(period)}` : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else { setData(d); setError(null); if (!period) setPeriod(d.period); }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tips: hide a note from your own view (or show it again). The note
  // stays on the record; reporting it is the usual Report path.
  async function toggleNote(line) {
    setNoteBusy(line.tipId);
    try {
      const res = await fetch('/api/tips/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipId: line.tipId, hidden: !line.noteHidden }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not change the note.');
      setTick((t) => t + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setNoteBusy(null);
    }
  }

  async function openStripe() {
    setStripeBusy(true);
    try {
      const res = await fetch(payoutsApiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dashboard' }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not open Stripe.');
      window.location.href = d.url;
    } catch (err) {
      setError(err.message);
      setStripeBusy(false);
    }
  }

  async function copyLink() {
    if (!data || !data.link) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${data.link.linkPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) { /* the link is selectable text */ }
  }

  const lanes = data ? data.lanes : null;
  const ready = data && data.payouts.state === 'ready';
  const history = data ? data.history.filter((l) => filter === 'all' || l.lane === filter) : [];
  const periods = data ? data.periods : [];
  const yearKey = data ? data.year : null;
  const isYearView = data && data.period === data.year;
  const next = data && data.top.nextPayout;
  const linkHost = typeof window !== 'undefined' ? window.location.host : SITE.productionDomain.replace(/^https?:\/\//, '');
  const shownLanes = lanes ? LANE_ORDER.filter((k) => k !== 'payouts' && (k !== 'bookings' || lanes.bookings.shows)) : [];

  return (
  <main className="library-stage money-stage">
    <BackButton fallbackHref="/account" />

    <div className="money-head">
      <div className="money-head-text">
        <div className="hero-eyebrow">{data && data.creator.displayName ? `Creator · ${data.creator.displayName}` : 'Creator'}</div>
        <div className="money-title-row">
          <h1>Money</h1>
          {data && (
            <select className="money-period" value={period || data.period} onChange={(e) => { setFilter('all'); setPeriod(e.target.value); }} aria-label="Month">
              {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
              {yearKey && <option value={yearKey}>All of {yearKey}</option>}
            </select>
          )}
        </div>
        <p className="money-lede">Every lane in one place: what came in, what is owed, what Stripe already holds for you.</p>
      </div>
      <div className="money-head-actions">
        {data && (ready
          ? <span className="money-pill ok">Payouts ready{data.payouts.bank ? ` · ${data.payouts.bank.name} ····${data.payouts.bank.last4}` : ''}</span>
          : <Link href="/account" className="money-pill wait">Set up payouts on your account →</Link>)}
        {data && <a className="account-btn-secondary money-btn" href={`${apiPath}${apiPath.includes('?') ? '&' : '?'}period=${encodeURIComponent(data.period)}&format=csv`}>Export CSV</a>}
        {ready && <button type="button" className="unlock-btn money-btn" onClick={openStripe} disabled={stripeBusy}>{stripeBusy ? 'Opening…' : 'Open Stripe'}</button>}
      </div>
    </div>

    {error && <p className="asup-note error" role="alert">{error}</p>}
    {loading && !data && <p className="money-loading">Adding it up…</p>}

    {data && (
      <>
        <div className="money-kpis">
          <div className="money-kpi">
            <span className="money-kpi-label">{isYearView ? `${data.year} · all lanes` : 'This month · all lanes'}</span>
            <span className="money-kpi-amount">{dollars(data.top.monthCents)}</span>
            <span className="money-kpi-note">
              {shownLanes.map((k, i) => `${i ? ' · ' : ''}${LANES[k].short.toLowerCase()} ${dollars(lanes[k].monthCents)}`).join('')}
            </span>
          </div>
          <div className="money-kpi accent">
            <span className="money-kpi-label">Owed to you</span>
            <span className="money-kpi-amount">{dollars(data.top.owedCents)}</span>
            <span className="money-kpi-note">
              {next && next.note
                ? next.note
                : next && next.willPay
                  ? `Member support not yet paid. Transfers ${fmtDay(next.on)} (minimum ${dollars(data.top.minimumCents)}).`
                  : next && next.reason === 'set up payouts'
                    ? 'Member support waits until payouts are set up.'
                    : data.top.owedCents > 0
                      ? `Carries over until you reach ${dollars(data.top.minimumCents)}.`
                      : 'Nothing waiting. Member support adds up here through the month.'}
            </span>
          </div>
          <div className="money-kpi">
            <span className="money-kpi-label">In your Stripe balance</span>
            <span className="money-kpi-amount">{data.payouts.availableCents == null ? '—' : dollars(data.payouts.availableCents)}</span>
            <span className="money-kpi-note">
              {data.payouts.summaryError
                ? data.payouts.summaryError
                : data.payouts.availableCents == null
                  ? 'Shows once payouts are set up.'
                  : `${dollars(data.payouts.pendingCents)} pending${data.payouts.nextBankPayout ? ` · next bank payout ${fmtDayOnly(data.payouts.nextBankPayout.arrivalDate)}${data.payouts.nextBankPayout.estimate ? ' (estimate)' : ''}` : ''}`}
            </span>
          </div>
          <div className="money-kpi">
            <span className="money-kpi-label">Paid to you in {data.year}</span>
            <span className="money-kpi-amount">{dollars(data.top.paidYearCents)}</span>
            <span className="money-kpi-note">Transfers plus card money that reached your account. Stripe sends your 1099.</span>
          </div>
        </div>

        <div className="money-lanes">
          {shownLanes.map((k) => {
            const lane = lanes[k];
            return (
              <div className={`money-lane lane-${k}`} key={k} id={`lane-${k}`}>
                <span className="money-lane-eyebrow">{LANES[k].label}</span>
                <span className="money-lane-amount">{dollars(lane.monthCents)}</span>
                <div className="money-lane-rows">
                  {k === 'member_support' && (
                    <>
                      <Row label="Member share" value={dollars(lane.shareCents)} />
                      <Row label="Referral bonus" value={dollars(lane.referralCents)} />
                      {lane.carriedCents > 0 && <Row label="Carried from before" value={dollars(lane.carriedCents)} />}
                      <Row label="Owed to you" value={dollars(lane.owedCents)} />
                    </>
                  )}
                  {k === 'ad_share' && (
                    <>
                      {lane.titles.map((t) => <Row key={t.episodeId || t.title} label={`${t.title} · ${Number(t.units || 0).toLocaleString('en-US')} ad${t.units === 1 ? '' : 's'}`} value={dollars(t.cents)} />)}
                      {lane.owedCents > 0 && <Row label="Owed to you" value={dollars(lane.owedCents)} />}
                      {lane.titles.length === 0 && <Row label="No ads inside your titles this period" value="" />}
                    </>
                  )}
                  {k === 'tips' && (
                    <>
                      {lane.count > 0 && <Row label={`${lane.count} tip${lane.count === 1 ? '' : 's'} · ${lane.people} ${lane.people === 1 ? 'person' : 'people'}`} value={dollars(lane.grossCents)} />}
                      {lane.cutCents > 0 && <Row label={`Studio cut${lane.cutPercent != null ? ` ${lane.cutPercent}%` : ''}`} value={`−${dollars(lane.cutCents)}`} />}
                      {lane.count > 0 && <Row label="With a note" value={lane.noteCount} />}
                      {lane.refunds > 0 && <Row label={`${lane.refunds} refund${lane.refunds === 1 ? '' : 's'}`} value={`−${dollars(lane.refundCents)}`} />}
                      {lane.count === 0 && lane.refunds === 0 && <Row label="No tips this period" value="" />}
                    </>
                  )}
                  {k === 'sales' && (
                    <>
                      {lane.titles.map((t) => <Row key={t.key} label={`${t.title}${t.type === 'series' ? ' · series' : ''} · ${t.sold} sold`} value={dollars(t.cents)} />)}
                      {lane.refunds > 0 && <Row label={`${lane.refunds} refund${lane.refunds === 1 ? '' : 's'}`} value={`−${dollars(lane.refundCents)}`} />}
                      {lane.titles.length === 0 && lane.refunds === 0 && <Row label="No sales this period" value="" />}
                    </>
                  )}
                  {k === 'backing' && (
                    <>
                      {lane.pitches.map((p) => (
                        <span key={p.id}>
                          <Row label={`${p.title} · ${p.backers} backer${p.backers === 1 ? '' : 's'}`} value={dollars(p.raisedCents)} />
                          {p.cutCents > 0 && <Row label="Studio cut" value={`−${dollars(p.cutCents)}`} />}
                          <Row label="Raised so far" value={p.goalCents ? `${dollars(p.allRaisedCents)} of ${dollars(p.goalCents)}` : dollars(p.allRaisedCents)} />
                        </span>
                      ))}
                      {lane.pitches.length === 0 && <Row label="No backing this period" value="" />}
                    </>
                  )}
                  {k === 'bookings' && (
                    <>
                      {lane.places.map((p) => (
                        <span key={p.id}>
                          <Row label={`${p.title} · ${p.shoots} shoot${p.shoots === 1 ? '' : 's'}`} value={dollars(p.bookingCents)} />
                          <Row label="Studio cut" value={`−${dollars(p.cutCents)}`} />
                        </span>
                      ))}
                      {lane.nextShoot && <Row label="Next shoot" value={`${fmtDayOnly(lane.nextShoot.startsOn)}, paid`} />}
                      {lane.places.length === 0 && !lane.nextShoot && <Row label="No bookings this period" value="" />}
                    </>
                  )}
                </div>
                <span className="money-lane-note">
                  {k === 'member_support' && `Pays by transfer on the 1st once you are owed ${dollars(data.top.minimumCents)}.`}
                  {k === 'ad_share' && `${lane.percent == null ? 'Your share' : `${lane.percent}%`} of what advertisers paid for the ads inside your titles, credited on the 1st for the month before and paid with member support.`}
                  {k === 'tips' && (ready ? 'In your Stripe balance the moment the card clears. The fan covers the card fee.' : 'Set up payouts and the Tip button turns on for your fans.')}
                  {k === 'sales' && 'Your share lands in your Stripe balance at the sale.'}
                  {k === 'backing' && 'In your Stripe balance the moment a backer pays.'}
                  {k === 'bookings' && 'In your Stripe balance when the producer pays.'}
                </span>
                <Link href={LANE_LINKS[k]} className="money-lane-link">{LANE_LINK_TEXT[k]}</Link>
              </div>
            );
          })}
        </div>

        <div className="money-two" id="supporters">
          <div className="account-card money-card">
            <div className="money-card-head">
              <span className="account-subheading">Your link</span>
              {data.link && <button type="button" className="account-btn-secondary money-btn-small" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>}
            </div>
            {data.link ? (
              <>
                <span className="money-link">{linkHost}{data.link.linkPath}</span>
                <div className="money-grid2">
                  <Row label="Joined through it" value={data.link.joined} />
                  <Row label="Still members" value={data.link.active} />
                  <Row label="Bonus this month" value={dollars(data.link.bonusMonthCents)} />
                  <Row label="Bonus all time" value={dollars(data.link.bonusTotalCents)} />
                </div>
                <span className="money-lane-note">
                  Standard {dollars((data.link.bonusTable || {}).standard)} · Premium {dollars((data.link.bonusTable || {}).premium)} · Sponsor {dollars((data.link.bonusTable || {}).sponsor)} per month, {data.link.bonusMonths === 0 ? 'for as long as they stay' : `for a member's first ${data.link.bonusMonths} months`}.
                  {!data.link.handle && ' Set a handle on your account and the link becomes /@yourname.'}
                </span>
              </>
            ) : <span className="money-lane-note">The referral link is for creators with released work.</span>}
          </div>
          <div className="account-card money-card">
            <span className="account-subheading">Supporters</span>
            <div className="money-grid2">
              <Row label="Picked you in their lineup" value={data.supporters.picked} />
              <Row label="By watching" value={data.supporters.watching} />
              <Row label="Backed a pitch" value={data.supporters.backers} />
              <Row label="Bought a title" value={data.supporters.buyers} />
              {data.supporters.tippers > 0 && <Row label="Tipped you" value={data.supporters.tippers} />}
            </div>
            <span className="money-lane-note">
              {data.supporters.names.length
                ? <>Names shown where they chose to share: <b>{data.supporters.names.map((x) => x.displayName).join(', ')}</b>. The rest are counted, not named.</>
                : 'Members are counted, not named, unless they chose to share their name in Artist Support.'}
            </span>
          </div>
        </div>

        <div className="account-card money-history" id="history">
          <div className="money-card-head">
            <h2>History</h2>
            <div className="money-chips" role="tablist" aria-label="Lane">
              <button type="button" className={`money-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
              {LANE_ORDER.filter((k) => k !== 'bookings' || lanes.bookings.shows).map((k) => (
                <button type="button" key={k} className={`money-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                  {LANES[k].short}{data.laneCounts[k] ? ` ${data.laneCounts[k]}` : ''}
                </button>
              ))}
            </div>
          </div>
          {history.length === 0 ? (
            <p className="money-empty">Nothing in {data.periodLabel}{filter !== 'all' ? ` under ${LANES[filter].label}` : ''}.</p>
          ) : (
            <div className="money-table-wrap">
              <table className="money-table">
                <thead>
                  <tr><th>Date</th><th>Lane</th><th>What</th><th>Where it is</th><th className="num">Yours</th></tr>
                </thead>
                <tbody>
                  {history.map((l) => (
                    <tr key={l.id}>
                      <td className="money-date">{fmtDay(l.at)}</td>
                      <td><span className={`money-tag lane-${l.lane}`}>{l.kind.replace('_', ' ')}</span></td>
                      <td>
                        {l.href ? <Link href={l.href}>{l.label}</Link> : l.label}{l.detail ? <span className="money-detail"> · {l.detail}</span> : null}
                        {l.kind === 'tip' && l.note && (
                          <button type="button" className="money-note-btn" onClick={() => toggleNote(l)} disabled={noteBusy === l.tipId}>
                            {noteBusy === l.tipId ? '…' : l.noteHidden ? 'Show note' : 'Hide note'}
                          </button>
                        )}
                      </td>
                      <td className="money-where">{l.where}</td>
                      <td className={`num ${l.cents < 0 ? 'neg' : ''}`}>{signed(l.cents, l.lane)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="money-card-foot">
            <span className="money-lane-note">
              Showing {data.periodLabel}{data.historyTotal > data.history.length ? ` · the first ${data.history.length} of ${data.historyTotal} lines; the CSV has every one` : ''}. Every line names its source: the member payment, the sale, the backing, the booking, the Stripe transfer.
            </span>
            {periods.length > 1 && !isYearView && periods.indexOf(data.period) < periods.length - 1 && (
              <button type="button" className="account-btn-secondary money-btn-small" onClick={() => { setFilter('all'); setPeriod(periods[periods.indexOf(data.period) + 1]); }}>Earlier month</button>
            )}
          </div>
        </div>

        <div className="money-two">
          <div className="account-card money-card">
            <span className="account-subheading">How the money moves</span>
            <p className="money-copy">Member support is the studio&rsquo;s revenue shared with you: it adds up through the month and goes to your Stripe account by transfer on the 1st once you are owed {dollars(data.top.minimumCents)}. Tips, sales, backing and bookings are the fan&rsquo;s money: your share lands in your Stripe balance when the card clears. Stripe then pays your bank on your Express schedule.</p>
          </div>
          <div className="account-card money-card">
            <span className="account-subheading">Tax season</span>
            <p className="money-copy">Stripe files your 1099 forms from the money that reached your account and sends them through your Express dashboard in January. Your {data.year} total so far is above; the CSV has every line for your accountant.</p>
            {ready && <button type="button" className="money-lane-link money-linkbtn" onClick={openStripe} disabled={stripeBusy}>Open your Express dashboard →</button>}
          </div>
        </div>
      </>
    )}
  </main>
  );
}
