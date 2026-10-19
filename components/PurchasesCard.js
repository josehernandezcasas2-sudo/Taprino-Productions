import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dollars } from '../lib/purchaseRules';
import { SITE } from '../lib/siteConfig';

// "Your purchases" on /account (mockup 2026-10-19): every title the
// account owns, with the self-serve refund while it's allowed
// (lib/purchaseRules.js refundEligibility). Reads /api/purchases; the
// app's PurchasesCard mirrors it. Renders nothing until there's at
// least one purchase, unless `forceOpen` (the ?bought= return).
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const mins = (s) => (s ? `${Math.round(s / 60)} min` : null);
const KIND = { movie: 'Feature', short: 'Short film', series: 'Series', podcast: 'Podcast', bonus: 'Bonus', vertical: 'Vertical' };

export default function PurchasesCard({ apiPath = '/api/purchases', forceOpen = false, isSubscriber = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  // The tab bar's "Your purchases" row lands on #purchases: open the card
  // even when it's empty, so the link never leads nowhere. Read after
  // mount, so the server and the first client render agree.
  const [hashOpen, setHashOpen] = useState(false);
  useEffect(() => { setHashOpen(typeof window !== 'undefined' && window.location.hash === '#purchases'); }, []);

  async function load() {
    try {
      const res = await fetch(apiPath);
      const d = await res.json();
      if (d.error) setError(d.error); else setData(d);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, [apiPath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refund(item) {
    if (!window.confirm(`Refund ${dollars(item.paidCents)} for "${item.title}"? You lose the title; the money goes back to your card in a few days.`)) return;
    setBusy(item.id);
    setError(null);
    try {
      const res = await fetch('/api/purchases/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchaseId: item.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'The refund didn’t go through.');
      setDone((m) => ({ ...m, [item.id]: true }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const items = data ? data.items : [];
  if (!forceOpen && !hashOpen && (!data || items.length === 0) && !Object.keys(done).length) return null;
  const days = data && data.refundDays ? data.refundDays : 14;
  const pct = data && data.refundWatchPercent ? data.refundWatchPercent : 10;

  return (
    <div className="account-card purch-card" id="purchases">
      <div className="account-subheading">Your purchases</div>
      <p className="account-card-lede">Titles you own. They play without ads and stay here even when they leave the catalogue, on the website and in the app.</p>
      {error && <p className="asup-note error">{error}</p>}
      {Object.keys(done).length > 0 && <p className="asup-note ok">Refunded. The money is on its way back to your card.</p>}
      {data && items.length === 0 && <p className="account-fineprint">Nothing bought yet. Titles with a price show &ldquo;Own this title&rdquo; on their page.</p>}
      <div className="purch-list">
        {items.map((it) => (
          <div key={it.id} className={`purch-row${it.withdrawn ? ' gone' : ''}`}>
            <Link href={it.href} className="purch-main">
              <span className="purch-thumb" style={it.poster ? { backgroundImage: `url(${it.poster})` } : undefined} />
              <span className="purch-text">
                <b>{it.title}{it.type === 'series' ? ' · the series' : ''}</b>
                <span>{[it.creatorName, it.type === 'series' ? `${it.episodeCount} episode${it.episodeCount === 1 ? '' : 's'} · new ones included` : (KIND[it.contentType] || it.contentType), it.type !== 'series' ? mins(it.runtimeSeconds) : null].filter(Boolean).join(' · ')}</span>
                <small className={it.withdrawn ? 'gone' : ''}>{it.withdrawn ? `No longer on ${SITE.name} · still yours` : `Bought ${fmtDate(it.boughtAt)} · ${dollars(it.paidCents)}`}</small>
              </span>
            </Link>
            <div className="purch-foot">
              <span>
                Watched {it.watchedPercent}%
                {it.refund.ok ? ` · refund available until ${fmtDate(it.refund.until)}` : it.refund.reason ? ` · ${it.refund.reason}` : ''}
              </span>
              {it.refund.ok && (
                <button type="button" className="buy-chip ghost" onClick={() => refund(it)} disabled={busy === it.id}>{busy === it.id ? 'Refunding…' : 'Refund'}</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="purch-help">
        <b>Receipts and refunds</b>
        <span>Stripe emailed a receipt for each purchase. Changed your mind? Refund yourself from this page within {days} days, as long as you&rsquo;ve watched less than {pct}% of the title. After that, email {SITE.contactEmail}; those refunds are at our discretion and final.</span>
      </div>
      {!isSubscriber && (
        <p className="account-fineprint">Want everything? {SITE.premiumTier} members watch every title on the site from $7.99 a month. What you&rsquo;ve bought stays yours either way. <a href="#membership">See membership plans →</a></p>
      )}
    </div>
  );
}
