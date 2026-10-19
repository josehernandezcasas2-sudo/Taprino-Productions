import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dollars } from '../../lib/purchaseRules';
import { SITE } from '../../lib/siteConfig';

// "Sales" (mockup 2026-10-19): what people paid outright for a creator's
// titles, this month and all time, by title, with refunds. On /account
// between Member support and Bring your people for creators and admins;
// the app's SalesCard mirrors it. Reads /api/creator/sales
// (lib/purchases.js getSalesForCreator). Renders nothing until the
// creator has priced a title or sold one.
const monthLabel = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const STATE = { on: 'on sale', pending: 'in review', rejected: 'not approved', off: 'not selling' };

export default function SalesCard({ apiPath = '/api/creator/sales' }) {
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

  if (error) return null;
  if (!data || !data.available || !data.titles.length) return null;

  return (
    <div className="account-card">
      <div className="account-subheading">Sales</div>
      <h3 className="refc-title">{monthLabel()}</h3>
      <p className="account-card-lede">
        Titles people bought outright. Each sale pays into your Stripe account the moment it happens. Prices and sales are set from <Link href="/creator/my-work">My Work</Link>.
      </p>
      <div className="refc-stats">
        <div className="refc-stat"><b>{data.month.count}</b><span>sold this month</span></div>
        <div className="refc-stat"><b>{dollars(data.month.creatorCents)}</b><span>your share this month</span></div>
        <div className="refc-stat"><b>{data.allTime.count}</b><span>sold all time</span></div>
        <div className="refc-stat"><b>{dollars(data.allTime.creatorCents)}</b><span>your share all time</span></div>
      </div>
      <div className="payouts-list-head">By title</div>
      <div className="sales-rows">
        {data.titles.map((t) => {
          const pending = t.pendingCents != null;
          return (
            <div className="sales-row" key={`${t.type}:${t.targetId}`}>
              <div>
                <b>{t.title}{t.type === 'series' ? ' · the series' : ''}</b>
                <small className={pending || t.priceState === 'pending' ? 'pending' : ''}>
                  {t.priceCents ? `${dollars(t.priceCents)} · ${STATE[t.priceState] || t.priceState}` : pending ? `${dollars(t.pendingCents)} · in review` : 'no price'}
                  {pending && t.priceCents ? ` · ${dollars(t.pendingCents)} in review` : ''}
                  {t.sale ? ` · ${t.sale.percent}% off until ${new Date(t.sale.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </small>
              </div>
              <span className={`n${t.sold ? '' : ' dim'}`}>{t.sold ? `${t.sold} · ${dollars(t.creatorCents)}` : '—'}</span>
            </div>
          );
        })}
      </div>
      <p className="account-fineprint">
        {data.refundsThisYear.count > 0
          ? `${data.refundsThisYear.count} refund${data.refundsThisYear.count === 1 ? '' : 's'} this year (${dollars(data.refundsThisYear.creatorCents)} taken back from your balance). `
          : 'No refunds this year. '}
        A buyer can refund themselves within the first days while they&rsquo;ve barely watched; the rest are handled by {SITE.name}. A refunded buyer loses the title.
      </p>
    </div>
  );
}
