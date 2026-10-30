import { useState } from 'react';
import Link from 'next/link';
import MembershipPlans, { formatPlanPrice } from '../MembershipPlans';
import ReferredByField from '../ReferredByField';
import { TIER_INFO, isPaidTier, tierLabel } from '../../lib/membershipTiers';
import { SITE } from '../../lib/siteConfig';
import { formatLongDate, formatShortDate } from '../../lib/accountRules';

// /account/membership (option B, 2026-10-29). A paying member sees one
// plan row — name, price, renews, what it includes, Manage subscription
// (Stripe's portal) — with the full picker behind "Compare plans"; a free
// account sees "Did a creator send you?" and the picker; the team, comped
// and promo-code accounts see the free-access note. Then Membership
// Artist Support and "Have a code?". The handlers are the ones the old
// one-page /account had.
export default function MembershipSection({ plans = [], tier = 'basic', subscriptionDetails = null, freeAccessNote = null, viaHandle = null }) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [joiningTier, setJoiningTier] = useState(null);
  const [referredBy, setReferredBy] = useState(viaHandle || '');
  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);
  const [comparing, setComparing] = useState(false);

  const paid = isPaidTier(tier) && !freeAccessNote;
  const plan = plans.find((p) => p.tier === tier) || null;
  const info = TIER_INFO[tier] || TIER_INFO.basic;

  // Join: straight into Stripe Checkout (these pages only render signed
  // in, so no sign-in detour like the episode paywall needs). Checkout
  // comes back to the Membership page (pages/api/confirm-checkout.js).
  async function startCheckout(planTier) {
    setJoiningTier(planTier);
    const via = referredBy.trim();
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: planTier, returnTo: '/account', ...(via ? { via, viaSource: via === viaHandle ? 'link' : 'typed' } : {}) })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout isn’t available right now.');
        setJoiningTier(null);
      }
    } catch (err) {
      alert('Could not start checkout.');
      setJoiningTier(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/create-portal-session', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Could not open subscription settings.');
        setPortalLoading(false);
      }
    } catch (err) {
      alert('Could not open subscription settings.');
      setPortalLoading(false);
    }
  }

  async function handleRedeemCode(e) {
    e.preventDefault();
    setRedeemError(null);
    setRedeemSuccess(null);
    setRedeeming(true);
    try {
      const res = await fetch('/api/account/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemInput.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemError(data.error || 'Could not redeem that code.');
        setRedeeming(false);
        return;
      }
      setRedeemSuccess(data.expiresAt);
      setRedeemInput('');
      // A full reload: the plan row and the header pill both come from
      // getServerSideProps, so this is the simplest way to show the new
      // access everywhere at once.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setRedeemError('Could not redeem that code — try again.');
      setRedeeming(false);
    }
  }

  return (
    <>
      <div className="account-card" id="membership">
        <div className="account-subheading">Your plan</div>
        {paid ? (
          <>
            <div className="acct-plan-row">
              <div className="acct-plan-name">
                <span className="acct-plan-tier">{plan && !plan.legacy ? plan.name : tierLabel(tier)}</span>
                <span className="acct-plan-price">{plan ? `${formatPlanPrice(plan)} a ${plan.interval || 'month'}` : ''}</span>
              </div>
              <ul className="acct-plan-perks">
                {info.perks.map((p) => <li key={p}>{p}</li>)}
              </ul>
              {subscriptionDetails && (
                <p className="account-fineprint" style={{ margin: 0 }}>
                  {subscriptionDetails.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} {formatLongDate(subscriptionDetails.renewsAt)}. {SITE.premiumTier} is the name on your statement.
                </p>
              )}
              <div className="acct-plan-actions">
                <button type="button" className="account-btn-secondary" style={{ width: 'auto', marginBottom: 0 }} onClick={openPortal} disabled={portalLoading}>
                  {portalLoading ? 'Opening…' : 'Manage subscription'}
                </button>
                <button type="button" className="acct-linkbtn" onClick={() => setComparing((c) => !c)} aria-expanded={comparing}>
                  {comparing ? 'Hide plans' : 'Compare plans'}
                </button>
              </div>
              <p className="account-fineprint" style={{ margin: 0 }}>Switch plans, update the card or cancel in Manage subscription. Stripe handles it.</p>
            </div>
            {comparing && (
              <div style={{ marginTop: '1rem' }}>
                <MembershipPlans
                  plans={plans}
                  tier={tier}
                  subscriptionDetails={subscriptionDetails}
                  onJoin={startCheckout}
                  onPortal={openPortal}
                  joiningTier={joiningTier}
                  portalLoading={portalLoading}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {!freeAccessNote && <ReferredByField value={referredBy} onChange={setReferredBy} fromLink={viaHandle} />}
            <MembershipPlans
              plans={plans}
              tier={tier}
              subscriptionDetails={subscriptionDetails}
              freeAccessNote={freeAccessNote}
              onJoin={startCheckout}
              onPortal={openPortal}
              joiningTier={joiningTier}
              portalLoading={portalLoading}
            />
          </>
        )}
      </div>

      {/* Membership Artist Support — the creators a member's share goes to
          (pages/artist-support.js). */}
      <div className="account-card">
        <div className="account-subheading">Membership Artist Support</div>
        <p className="account-card-lede">
          Part of every month&rsquo;s membership goes to creators. Pick up to 10 and how your share splits between them; with no picks it follows what you watch.
        </p>
        <Link href="/artist-support" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block' }}>Choose your creators →</Link>
      </div>

      <div className="account-card">
        <div className="account-subheading">Have a code?</div>
        <form onSubmit={handleRedeemCode} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            aria-label="Code"
            value={redeemInput}
            onChange={(e) => setRedeemInput(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            style={{ flex: 1, marginBottom: 0 }}
            disabled={redeeming}
          />
          <button className="account-btn-secondary" type="submit" style={{ width: 'auto', marginBottom: 0 }} disabled={redeeming || !redeemInput.trim()}>
            {redeeming ? 'Checking…' : 'Redeem'}
          </button>
        </form>
        {redeemError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.4rem' }}>{redeemError}</p>}
        {redeemSuccess && (
          <p style={{ color: 'var(--ok)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
            Code accepted — you now have {SITE.premiumTier} through {formatLongDate(redeemSuccess)}. Refreshing…
          </p>
        )}
        <p className="account-fineprint" style={{ marginTop: '0.6rem' }}>A promo or gift code from the studio. A creator&rsquo;s handle goes in the field above the plans before you join.</p>
      </div>
    </>
  );
}

// What the hub's Membership tile says (pages/account.js).
export function membershipTileLines({ plans = [], tier = 'basic', subscriptionDetails = null, freeAccessNote = null }) {
  if (freeAccessNote) return [`${SITE.premiumTier} · free access`, 'Given by the team or a code'];
  if (isPaidTier(tier)) {
    const plan = plans.find((p) => p.tier === tier) || null;
    const name = plan && !plan.legacy ? plan.name : tierLabel(tier);
    const price = plan ? ` · ${formatPlanPrice(plan)} a ${plan.interval || 'month'}` : '';
    const when = subscriptionDetails ? `${subscriptionDetails.cancelsAtPeriodEnd ? 'Ends' : 'Renews'} ${formatShortDate(subscriptionDetails.renewsAt)}` : 'Manage subscription';
    return [`${name}${price}`, when];
  }
  return ['Basic · free, with ads', `Join ${SITE.premiumTier} for the whole library`];
}
