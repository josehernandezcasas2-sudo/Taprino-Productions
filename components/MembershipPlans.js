import { TIER_INFO, DISPLAY_ORDER, isPaidTier, tierLabel } from '../lib/membershipTiers';
import { SITE } from '../lib/siteConfig';

// The Membership card's plan picker on /account (mockups/membership-tiers.html,
// signed off 2026-10-12): Basic plus every plan on sale in Stripe
// (lib/membershipPlans.js), the viewer's own plan marked, Join → Stripe
// Checkout for that tier, and Manage subscription (Stripe's portal, where
// switching plans happens) for a paying member.
//
// `freeAccessNote` (team / comped / promo code) replaces the picker: those
// accounts have Premium without a subscription, so there's nothing to buy
// or switch.
export function formatPlanPrice(plan) {
  if (!plan) return 'Free';
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase() }).format((plan.amountCents || 0) / 100);
  return money;
}

function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MembershipPlans({ plans = [], tier = 'basic', subscriptionDetails = null, freeAccessNote = null, onJoin, onPortal, joiningTier = null, portalLoading = false }) {
  if (freeAccessNote) {
    return (
      <div className="account-free-access-note">
        <span className="account-free-access-badge">Free access</span>
        <p>{freeAccessNote}</p>
      </div>
    );
  }

  const paid = isPaidTier(tier);
  const byTier = Object.fromEntries(plans.map((p) => [p.tier, p]));
  // Basic first for a free account; a member's own plan first.
  const tiers = ['basic', ...DISPLAY_ORDER.filter((t) => t !== 'basic' && byTier[t])];
  if (paid && tiers.includes(tier)) tiers.splice(tiers.indexOf(tier), 1), tiers.unshift(tier);
  else if (paid) tiers.unshift(tier); // on a plan no longer on sale (e.g. Sponsor after the window)

  return (
    <>
      {!paid && <p className="account-card-lede">Pick how you want to watch. Switch or cancel any time from Manage subscription.</p>}
      <div className="mp-grid">
        {tiers.map((t) => {
          const info = TIER_INFO[t];
          const plan = byTier[t] || null;
          const current = t === tier;
          const cls = ['mp-plan', current && 'current', t === 'premium' && !current && 'featured', t === 'sponsor' && 'sponsor'].filter(Boolean).join(' ');
          const flag = current ? 'Your plan' : info.flag;
          const sub = current && subscriptionDetails;
          return (
            <div className={cls} key={t}>
              {flag && <span className={`mp-flag ${current ? 'now' : t === 'sponsor' ? 'ltd' : 'pop'}`}>{flag}</span>}
              <div className="mp-name">{plan && !plan.legacy ? plan.name : t === 'basic' ? 'Basic' : plan ? plan.name : tierLabel(t)}</div>
              <div className="mp-price">
                {plan ? formatPlanPrice(plan) : t === 'basic' ? 'Free' : '—'}
                {plan && <small>/ {plan.interval || 'month'}</small>}
              </div>
              <div className="mp-tag">
                {sub
                  ? `${sub.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} ${formatDate(sub.renewsAt)}`
                  : info.tagline}
              </div>
              <ul className="mp-perks">
                {info.perks.map((p) => <li key={p}>{p}</li>)}
                {info.missing.map((p) => <li key={p} className="no">{p}</li>)}
              </ul>
              {current && paid && (
                <button type="button" className="mp-btn" onClick={onPortal} disabled={portalLoading}>
                  {portalLoading ? 'Opening…' : 'Manage subscription'}
                </button>
              )}
              {current && !paid && <span className="mp-btn ghost">Current plan</span>}
              {!current && t === 'basic' && <span className="mp-btn ghost">Cancel in Manage subscription</span>}
              {!current && t !== 'basic' && (
                paid
                  ? (
                    <button type="button" className={`mp-btn ${t === 'sponsor' ? 'brass' : t === 'premium' ? 'primary' : ''}`} onClick={onPortal} disabled={portalLoading}>
                      Switch to {tierLabel(t)}
                    </button>
                  ) : (
                    <button type="button" className={`mp-btn ${t === 'sponsor' ? 'brass' : t === 'premium' ? 'primary' : ''}`} onClick={() => onJoin(t)} disabled={Boolean(joiningTier)}>
                      {joiningTier === t ? 'Opening checkout…' : t === 'sponsor' ? 'Become a Sponsor' : `Join ${tierLabel(t)}`}
                    </button>
                  )
              )}
            </div>
          );
        })}
      </div>
      <div className="account-fineprint" style={{ marginTop: '1rem' }}>
        {paid
          ? '“Manage subscription” opens Stripe’s own secure page — switch plans, cancel, update your card, or view invoices there.'
          : `Live channels run ads on every plan. Payment and cancellation are handled by Stripe. ${SITE.premiumTier} is the name on your statement.`}
      </div>
    </>
  );
}
