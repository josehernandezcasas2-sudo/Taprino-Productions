import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LANES, LANE_ORDER, dollars } from '../../lib/creatorMoneyRules';

// "Money" on /account for creators and admins (2026-10-23): the four
// numbers from the Money page and a line per lane, linking to
// /creator/money. Replaced the Member support, Sales and Bring your
// people cards (their detail lives on the page now); the Payouts card
// stays above it because Stripe's onboarding returns there. The app's
// MoneySummaryCard mirrors it. Reads /api/creator/money.
export default function MoneySummaryCard({ apiPath = '/api/creator/money' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) (d.error ? setError(d.error) : setData(d)); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [apiPath]);

  const lanes = data ? LANE_ORDER.filter((k) => k !== 'payouts' && (k !== 'bookings' || data.lanes.bookings.shows)) : [];
  const next = data && data.top.nextPayout;
  return (
    <div className="account-card money-summary" id="money">
      <div className="account-subheading">Money</div>
      <h3 className="refc-title">{data ? data.periodLabel : 'This month'}</h3>
      <p className="account-card-lede">
        Member support, title sales, backing and bookings in one place, with what is owed, what Stripe holds for you, and every line as a CSV.
      </p>
      {error && <p className="asup-note error">{error}</p>}
      {data && (
        <>
          <div className="refc-stats">
            <div className="refc-stat"><b>{dollars(data.top.monthCents)}</b><span>this month, all lanes</span></div>
            <div className="refc-stat"><b>{dollars(data.top.owedCents)}</b><span>owed to you{next && next.willPay ? ' · pays on the 1st' : ''}</span></div>
            <div className="refc-stat"><b>{data.payouts.availableCents == null ? '—' : dollars(data.payouts.availableCents)}</b><span>in your Stripe balance</span></div>
            <div className="refc-stat"><b>{dollars(data.top.paidYearCents)}</b><span>paid to you in {data.year}</span></div>
          </div>
          <div className="money-summary-lanes">
            {lanes.map((k) => (
              <span key={k} className="money-row"><span><i className={`money-dot lane-${k}`} />{LANES[k].label}</span><b>{dollars(data.lanes[k].monthCents)}</b></span>
            ))}
          </div>
        </>
      )}
      <Link href="/creator/money" className="account-btn-secondary money-summary-btn">Open your Money page →</Link>
    </div>
  );
}
