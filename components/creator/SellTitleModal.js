import { useState } from 'react';
import { CloseIcon, usePlayerIconOverrides } from '../PlayerIcons';
import { dollars, salePriceCents, splitPurchase, SALE_PERCENTS, SALE_MAX_DAYS, PRICE_MIN_CENTS, PRICE_MAX_CENTS, DEFAULT_CUT_PERCENT } from '../../lib/purchaseRules';
import { SITE } from '../../lib/siteConfig';

// "Sell this title" + "Run a sale" (mockup 2026-10-19), opened from a row
// on /creator/my-work for an episode or a whole series. Talks to
// /api/creator/pricing (lib/purchases.js): a first price or a change goes
// to the review queue; a sale needs no review (it only lowers an
// approved price). The app's SellTitleSheet mirrors it.
//
// target: { type: 'episode' | 'series', id, title, sub }
// price: the title_prices row or null · settings: from the GET
export const priceState = (price) => (!price ? 'none' : price.pending_cents != null ? 'pending' : price.status);
export const STATE_LABEL = { on: 'On sale', pending: 'In review', rejected: 'Not approved', off: 'Not selling', none: 'Not for sale' };

const toCents = (s) => Math.round(Number(String(s).replace(/[^0-9.]/g, '')) * 100);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export default function SellTitleModal({ target, price, settings = {}, isAdmin = false, onClose, onSaved }) {
  const iconOverrides = usePlayerIconOverrides();
  const cut = settings.cutPercent ?? DEFAULT_CUT_PERCENT;
  const minCents = settings.minCents ?? PRICE_MIN_CENTS;
  const maxCents = settings.maxCents ?? PRICE_MAX_CENTS;
  const refundDays = settings.refundDays ?? 14;
  const refundPct = settings.refundWatchPercent ?? 10;
  const state = priceState(price);
  const liveCents = price && price.price_cents ? Number(price.price_cents) : null;
  const [priceInput, setPriceInput] = useState(price ? ((price.pending_cents ?? price.price_cents ?? 499) / 100).toFixed(2) : '4.99');
  const activeSale = price && price.sale_percent && price.sale_ends_at && new Date(price.sale_ends_at) > new Date();
  const [salePercent, setSalePercent] = useState(activeSale ? Number(price.sale_percent) : 30);
  const [saleEnds, setSaleEnds] = useState(activeSale ? String(price.sale_ends_at).slice(0, 10) : plusDays(7));
  const [membersOnly, setMembersOnly] = useState(Boolean(activeSale && price.sale_members_only));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const cents = toCents(priceInput);
  const validCents = Number.isFinite(cents) && cents >= minCents && cents <= maxCents;
  const split = validCents ? splitPurchase(cents, cut) : null;
  const saleBase = liveCents || (validCents ? cents : 0);
  const saleCents = saleBase ? salePriceCents(saleBase, salePercent, minCents) : 0;
  const saleSplit = saleCents ? splitPurchase(saleCents, cut) : null;
  const unchanged = state === 'on' && liveCents === cents && price.pending_cents == null;

  async function act(action, body, done) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/creator/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, type: target.type, id: target.id, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setNotice(done);
      onSaved && onSaved(data.price);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sell-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{target.title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><CloseIcon size={16} src={iconOverrides.close} /></button>
        </div>
        {target.sub && <p className="sell-hint" style={{ marginTop: '-0.4rem' }}>{target.sub}</p>}

        <div className="sell-section">
          <h4>
            Sell this {target.type === 'series' ? 'series' : 'title'}
            <span className={`sell-state ${state === 'none' ? 'off' : state}`}>{STATE_LABEL[state]}{state === 'on' && liveCents ? ` · ${dollars(liveCents)}` : ''}</span>
          </h4>
          <p>
            People can buy this {target.type === 'series' ? 'series' : 'title'} outright and keep it, ad-free, for good.
            {target.type === 'series' ? ' One price covers every episode, including ones you add later. ' : ' '}
            You set the price; {isAdmin ? 'as an admin yours goes live at once' : 'we check it before it goes live'}. Members still watch it as part of their plan.
          </p>
          {price && price.pending_cents != null && (
            <p className="sell-hint">Waiting for review: {dollars(price.pending_cents)}{liveCents && state === 'on' ? ` (still on sale at ${dollars(liveCents)} meanwhile)` : ''}.</p>
          )}
          <label className="sell-label" htmlFor="sell-price">
            Price
            <div className="sell-price">
              <span>$</span>
              <input id="sell-price" type="number" min={minCents / 100} max={maxCents / 100} step="0.01" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
            </div>
          </label>
          <span className="sell-hint">Between {dollars(minCents)} and {dollars(maxCents)}.{target.type === 'series' ? ' A series usually sells for a little less than its episodes added up.' : ''}</span>
          {split && (
            <div className="sell-math">
              <div><span>Buyer pays</span><span>{dollars(split.paidCents)}</span></div>
              <div><span>Card processing (Stripe)</span><span>− {dollars(split.feeCents)}</span></div>
              <div><span>{SITE.name}, {cut}%</span><span>− {dollars(split.paidCents - split.feeCents - split.creatorCents)}</span></div>
              <div className="total"><span>You receive, per sale</span><span>{dollars(split.creatorCents)}</span></div>
            </div>
          )}
          <span className="sell-hint">Paid straight into your Stripe account at the moment of each sale, like Pitch Room backing. The studio&rsquo;s share covers hosting it for every buyer, for as long as they own it.</span>
          {price && price.rejection_note && (
            <div className="sell-why">
              <b>Why it wasn&rsquo;t approved</b>
              <span>{price.rejection_note}</span>
            </div>
          )}
          {error && <p className="own-error">{error}</p>}
          {notice && <p className="asup-note ok">{notice}</p>}
          <div className="sell-actions">
            <button type="button" className="own-btn" disabled={!validCents || unchanged || busy !== null} onClick={() => act('set', { cents }, isAdmin ? `On sale at ${dollars(cents)}.` : `Sent for review: ${dollars(cents)}. You’ll get a note when it’s decided.`)}>
              {busy === 'set' ? 'Saving…' : isAdmin ? (state === 'on' ? 'Change the price' : 'Put it on sale') : state === 'on' ? 'Send the new price for review' : 'Send for review'}
            </button>
            {state === 'on' && (
              <button type="button" className="own-btn ghost" disabled={busy !== null} onClick={() => act('stop', {}, 'Taken off sale. People who bought it keep it.')}>
                {busy === 'stop' ? 'Saving…' : 'Stop selling'}
              </button>
            )}
            {state === 'off' && liveCents && (
              <button type="button" className="own-btn ghost" disabled={busy !== null} onClick={() => act('start', {}, `Back on sale at ${dollars(liveCents)}.`)}>
                {busy === 'start' ? 'Saving…' : `Put back on sale at ${dollars(liveCents)}`}
              </button>
            )}
          </div>
        </div>

        {state === 'on' && liveCents && (
          <div className="sell-section">
            <h4>Run a sale <span className="sell-state off">{activeSale ? `On · ${price.sale_percent}% off` : 'Optional'}</span></h4>
            <p>Take a percentage off for a while, for a launch or a festival run. No review needed: a sale can only lower a price we&rsquo;ve already approved, never below {dollars(minCents)}, and runs at most {SALE_MAX_DAYS} days.</p>
            <div className="sell-grid">
              <label className="sell-label" htmlFor="sale-off">
                Off
                <select id="sale-off" value={salePercent} onChange={(e) => setSalePercent(Number(e.target.value))}>
                  {SALE_PERCENTS.map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </label>
              <label className="sell-label" htmlFor="sale-ends">
                Ends on
                <input id="sale-ends" type="date" value={saleEnds} min={plusDays(1)} max={plusDays(SALE_MAX_DAYS)} onChange={(e) => setSaleEnds(e.target.value)} />
              </label>
            </div>
            <label className="sell-label sell-check" htmlFor="sale-members">
              <input id="sale-members" type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
              {SITE.premiumTier} members only
            </label>
            {saleSplit && (
              <div className="sell-math">
                <div><span>Buyers see</span><span className="own-price sm"><b>{dollars(saleCents)}</b><s>{dollars(liveCents)}</s></span></div>
                <div className="total"><span>You receive, per sale</span><span>{dollars(saleSplit.creatorCents)}</span></div>
              </div>
            )}
            <div className="sell-actions">
              <button type="button" className="own-btn ghost" disabled={busy !== null || !saleEnds} onClick={() => act('sale', { percent: salePercent, endsAt: saleEnds, membersOnly }, `${salePercent}% off until ${saleEnds}.`)}>
                {busy === 'sale' ? 'Saving…' : activeSale ? 'Update the sale' : 'Start the sale'}
              </button>
              {activeSale && (
                <button type="button" className="own-btn ghost" disabled={busy !== null} onClick={() => act('end_sale', {}, 'Sale ended; back to the full price.')}>
                  {busy === 'end_sale' ? 'Saving…' : 'End the sale'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="sell-section">
          <div className="sell-agree">
            <b>What you&rsquo;re agreeing to</b>
            <span>
              Anyone who buys it keeps it. If you later take the {target.type === 'series' ? 'series' : 'title'} down or leave {SITE.name}, it comes off the catalogue but keeps playing for the people who bought it. A price change only applies to new buyers. A buyer can refund themselves within {refundDays} days if they&rsquo;ve watched less than {refundPct}%; that sale comes back out of your balance. Full terms: <a href="/terms#buying" target="_blank" rel="noopener">section 15</a>.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
