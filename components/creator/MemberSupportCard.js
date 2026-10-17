import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dollars } from '../../lib/artistSupportRules';

// "Member support": what Creator Share has credited a creator this month,
// what's owed, who's behind it, and the payouts so far. On /account
// between the Payouts card and "Bring your people" for creators and
// admins; the app's MemberSupportCard mirrors it. Reads
// /api/creator/member-support (lib/creatorShareBatch.js getCreatorMoney).
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

const PAYOUT_STATUS = { paid: ['Paid', 'paid'], pending: ['Sending', 'transit'], failed: ['Failed', 'failed'] };

export default function MemberSupportCard({ apiPath = '/api/creator/member-support' }) {
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

  const next = data && data.nextPayout;
  return (
    <div className="account-card msc-card">
      <div className="account-subheading">Member support</div>
      <h3 className="refc-title">{data ? data.periodLabel : 'This month'}</h3>
      <p className="account-card-lede">
        Part of every membership goes to the creators the member picks in <Link href="/artist-support">Artist Support</Link>, or to the ones they watch when they haven&rsquo;t picked. It adds up here through the month and pays out on the 1st.
      </p>
      {error && <p className="asup-note error">{error}</p>}
      {data && (
        <>
          <div className="refc-stats">
            <div className="refc-stat"><b>{dollars(data.monthCents)}</b><span>this month</span></div>
            <div className="refc-stat"><b>{dollars(data.owedCents)}</b><span>owed to you</span></div>
            <div className="refc-stat"><b>{data.supporters.picked}</b><span>picked you this month</span></div>
            <div className="refc-stat"><b>{data.supporters.watching}</b><span>by watching</span></div>
          </div>
          <div className="msc-next">
            <div className="payouts-tile-label">Next payout · {fmtDate(next.on)}</div>
            <div className="msc-next-amount">{dollars(next.cents)}</div>
            <div className="payouts-tile-detail">
              {next.willPay
                ? 'Goes to your Stripe account on the 1st, then to your bank on your payout schedule.'
                : next.reason === 'set up payouts'
                  ? 'Set up payouts above and this goes out on the 1st. Credits wait for you.'
                  : next.cents === 0
                    ? 'Nothing waiting right now. New credits add up here through the month.'
                    : `Carries over until you reach ${dollars(data.minimumCents)}.`}
            </div>
          </div>
          {data.monthReferralCents > 0 && (
            <p className="account-fineprint">{dollars(data.monthReferralCents)} of this month is referral bonus from members who joined through your link.</p>
          )}
          {data.supporters.names.length > 0 && (
            <p className="account-fineprint">
              Among them: {data.supporters.names.map((n) => `${n.displayName} (${n.how})`).join(', ')}. Only members who chose to show their name are listed.
            </p>
          )}
          {data.payouts.length > 0 && (
            <>
              <div className="payouts-list-head">Payouts</div>
              {data.payouts.map((p) => {
                const [label, cls] = PAYOUT_STATUS[p.status] || [p.status, 'transit'];
                return (
                  <div className="payouts-row" key={p.id}>
                    <div className="payouts-row-date">{p.periodLabel}<small>{fmtDate(p.paidAt)}</small></div>
                    <div className="payouts-row-amt">{dollars(p.cents)}</div>
                    <span className={`payouts-pill ${cls}`}>{label}</span>
                  </div>
                );
              })}
            </>
          )}
          <p className="account-fineprint">
            {data.pickedBy} member{data.pickedBy === 1 ? ' has' : 's have'} you in their lineup. Your share never changes what a member pays.
          </p>
        </>
      )}
    </div>
  );
}
