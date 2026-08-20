import Link from 'next/link';
import { SITE } from '../lib/siteConfig';

// Homepage promo strip pitching the paid tier. Only worth showing to
// people who aren't already subscribers — callers should pass
// isSubscriber and this component handles hiding itself, so pages don't
// each need their own conditional wrapper around it.
//
// Links to /account rather than straight to Stripe Checkout, matching how
// the rest of the site currently sends people to upgrade (the account
// page's own "Join Studio Tapa +" button). If that gets changed to jump
// straight to checkout, update it in one place (account.js) and this
// stays correct automatically.
export default function StudioTapaPromo({ isSubscriber }) {
  if (isSubscriber) return null;

  return (
    <div className="promo-banner full-bleed">
      <div className="promo-banner-inner">
        <div>
          <span className="promo-eyebrow">{SITE.premiumTier}</span>
          <h3>Go ad-free and back the creators directly.</h3>
          <p>
            Members get early episodes, gated series, and a direct line to what they fund.
          </p>
        </div>
        <Link href="/account" className="promo-cta">
          Join {SITE.premiumTier}
        </Link>
      </div>
    </div>
  );
}
