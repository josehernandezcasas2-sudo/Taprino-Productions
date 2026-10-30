import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useClerk } from '@clerk/nextjs';
import { dollars } from '../lib/purchaseRules';
import { SITE } from '../lib/siteConfig';

// Buy to own, the viewer's side (mockup 2026-10-19: "Own this title" on
// the episode page, "Own the whole series" on the series page, the
// "It's yours." banner after Checkout, Owned / Buy chips on episode rows).
// Offers come from lib/purchases.js getOffer: { forSale, cents, listCents,
// onSale, salePercent, saleEndsAt, creditCents, payCents, owned,
// ownedEpisodeIds, episodeCount }.

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// Starts Stripe Checkout for a title; signed-out viewers get the sign-in
// modal first (the API refuses them anyway). Returns { buy, busy, error }.
export function useBuyTitle({ isSignedIn }) {
  const router = useRouter();
  const { openSignIn } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function buy(type, id) {
    if (!isSignedIn) {
      openSignIn({ redirectUrl: router.asPath });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/purchases/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, returnTo: router.asPath.split('?')[0] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the payment.');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return { buy, busy, error };
}

export function PriceTag({ offer, size = 'lg' }) {
  if (!offer || !offer.forSale) return null;
  return (
    <span className={`own-price ${size}`}>
      <b>{dollars(offer.payCents)}</b>
      {(offer.onSale || offer.creditCents > 0) && <s>{dollars(offer.listCents)}</s>}
    </span>
  );
}

// The episode page's card. `tier` decides the surrounding copy: a
// premium title gets "Or join" underneath, a free one a line on why
// buying still makes sense.
export function OwnTitleCard({ offer, bundle, episode, creatorName, isSignedIn, isSubscriber, refundDays = 14, refundWatchPercent = 10, onSeePlans }) {
  const { buy, busy, error } = useBuyTitle({ isSignedIn });
  if (!offer || !offer.forSale || offer.owned) return null;
  const who = creatorName || 'the creator';
  return (
    <div className="own-wrap">
      <div className="own-card">
        <div className="own-head">
          <h3>Own this title</h3>
          <PriceTag offer={offer} />
        </div>
        {offer.onSale && (
          <div className="own-sale">{offer.salePercent}% off{offer.saleEndsAt ? ` until ${fmtDay(offer.saleEndsAt)}` : ''}</div>
        )}
        <ul className="own-bullets">
          <li>No ads, ever</li>
          <li>Yours for good, even if it leaves {SITE.name}</li>
          <li>Watch on the website and in the app</li>
        </ul>
        <button type="button" className="own-btn" onClick={() => buy('episode', episode.id)} disabled={busy}>
          {busy ? 'Opening Stripe…' : `Buy for ${dollars(offer.payCents)}`}
        </button>
        {error && <p className="own-error">{error}</p>}
        <p className="own-fine">
          One payment on Stripe&rsquo;s secure page. Most of it goes to {who}. Change your mind? Refund yourself within {refundDays} days, as long as you&rsquo;ve watched less than {refundWatchPercent}% of it.
        </p>
        {bundle && bundle.forSale && !bundle.owned && (
          <p className="own-fine">
            Or <Link href={`/series/${episode.seriesId}`}>own the whole series for {dollars(bundle.payCents)}</Link>: every episode, and any added later.
          </p>
        )}
      </div>
      {episode.tier === 'premium' && !isSubscriber ? (
        <div className="own-join">
          <h4>Or join {SITE.premiumTier}</h4>
          <p>Every title on the site, from $7.99 a month. Cancel any time.</p>
          <button type="button" className="own-btn ghost" onClick={onSeePlans}>See membership plans</button>
        </div>
      ) : episode.tier === 'free' ? (
        <p className="own-note">Free to watch with ads. Members already watch it without ads; buying keeps it in your library after it leaves the catalogue.</p>
      ) : null}
    </div>
  );
}

// The series page's card: the bundle, with the credit for episodes
// already bought one by one.
export function BundleCard({ bundle, series, creatorName, isSignedIn, isSubscriber, episodeTitles = {} }) {
  const { buy, busy, error } = useBuyTitle({ isSignedIn });
  if (!bundle || !bundle.forSale || bundle.owned) return null;
  const who = creatorName || 'the creator';
  const ownedCount = (bundle.ownedEpisodeIds || []).length;
  const ownedNames = (bundle.ownedEpisodeIds || []).map((id) => episodeTitles[id]).filter(Boolean);
  return (
    <div className="own-card bundle">
      <div className="own-head">
        <h3>Own the whole series</h3>
        <PriceTag offer={bundle} />
      </div>
      {bundle.onSale && (
        <div className="own-sale">{bundle.salePercent}% off{bundle.saleEndsAt ? ` until ${fmtDay(bundle.saleEndsAt)}` : ''}</div>
      )}
      <ul className="own-bullets">
        <li>All {bundle.episodeCount || ''} episodes, and any {who} adds later</li>
        <li>No ads, yours for good</li>
        <li>Watch on the website and in the app</li>
      </ul>
      <button type="button" className="own-btn" onClick={() => buy('series', series.id)} disabled={busy}>
        {busy ? 'Opening Stripe…' : `Buy the series for ${dollars(bundle.payCents)}`}
      </button>
      {error && <p className="own-error">{error}</p>}
      <p className="own-fine">
        Or buy episodes one at a time below.{!isSubscriber ? ` Members watch the whole series as part of ${SITE.premiumTier}.` : ''}
      </p>
      {ownedCount > 0 && (
        <p className="own-fine credit">
          You already own {ownedNames.length ? ownedNames.join(', ') : `${ownedCount} episode${ownedCount === 1 ? '' : 's'}`}. Buying the series takes {dollars(bundle.creditCents)} off for {ownedCount === 1 ? 'it' : 'them'}: {dollars(bundle.payCents)}.
        </p>
      )}
    </div>
  );
}

// After Checkout brings the buyer back with ?bought=<id> (or =cancelled).
export function BoughtBanner({ bought, title, email }) {
  if (!bought) return null;
  if (bought === 'cancelled') {
    return <div className="bought-banner cancelled">No charge was made. The title is still here whenever you want it.</div>;
  }
  return (
    <div className="bought-banner">
      <span className="bought-check" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <div>
        <b>It&rsquo;s yours.</b>
        <p>{title} is in your library for good.{email ? ` Receipt sent to ${email}.` : ''} Find it any time under Account → <Link href="/account/purchases">Your purchases</Link>.</p>
      </div>
    </div>
  );
}

export function OwnedChip({ small = false }) {
  return <span className={`own-chip${small ? ' sm' : ''}`}>Owned</span>;
}

// An episode row's price: Buy $1.99 / Owned / nothing.
export function BuyChip({ offer, onBuy, busy }) {
  if (!offer) return null;
  if (offer.owned) return <OwnedChip small />;
  if (!offer.forSale) return null;
  return (
    <button type="button" className="buy-chip" onClick={onBuy} disabled={busy}>
      Buy {dollars(offer.payCents)}{offer.onSale ? <s>{dollars(offer.listCents)}</s> : null}
    </button>
  );
}
