import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, getAdsForAccount } from '../../lib/adAccounts';
import AdManagerNav from '../../components/AdManagerNav';
import AdManagerFooter from '../../components/AdManagerFooter';
import AdvertiserAdForm from '../../components/AdvertiserAdForm';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { userId } = getAuth(req);

  // No separate "not signed in" page here — the ad manager's own sign-in
  // entry point is /advertise/login, so anyone landing on the dashboard
  // without a session goes there rather than seeing a half-empty page.
  if (!userId) {
    return { redirect: { destination: '/advertise/login', permanent: false } };
  }

  const adAccount = await getOwnAdAccount(userId);
  // Same reasoning — someone who's signed in but never created an ad
  // account has nothing to manage here yet. /advertise (not /advertise/login)
  // is where account creation actually happens.
  if (!adAccount) {
    return { redirect: { destination: '/advertise', permanent: false } };
  }

  const ads = await getAdsForAccount(adAccount.id);
  return { props: { adAccount, ads } };
}

const STATUS_LABEL = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected'
};

function centsToDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AdManagerDashboard({ adAccount: initialAdAccount, ads: initialAds }) {
  const router = useRouter();
  const [adAccount, setAdAccount] = useState(initialAdAccount);
  const [ads, setAds] = useState(initialAds);
  const [buyAmount, setBuyAmount] = useState('');
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyError, setBuyError] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState(null);

  function handleAdSubmitted(newAd) {
    setAds((prev) => [newAd, ...prev]);
  }

  async function refreshAccount() {
    try {
      const res = await fetch('/api/ads/update-account');
      const data = await res.json();
      if (res.ok) setAdAccount(data.account);
    } catch {
      // Silent — this is just a best-effort refresh of the balance
      // shown, not something the rest of the page depends on to work.
    }
  }

  // Stripe's redirect back here happens as soon as checkout completes on
  // their end, but the webhook that actually credits the account (see
  // pages/api/webhook.js) is a separate, asynchronous call from Stripe's
  // servers — it can genuinely land a moment after this page has already
  // loaded. A short handful of spaced-out refetches covers that gap
  // without needing to poll indefinitely.
  useEffect(() => {
    if (!router.isReady) return;
    const { credits } = router.query;
    if (credits === 'success') {
      setCheckoutNotice('Payment received — crediting your account…');
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts += 1;
        await refreshAccount();
        if (attempts >= 4) clearInterval(interval);
      }, 1500);
      return () => clearInterval(interval);
    }
    if (credits === 'cancelled') {
      setCheckoutNotice('Checkout was cancelled — no charge was made.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (checkoutNotice) {
      const t = setTimeout(() => setCheckoutNotice(null), 6000);
      return () => clearTimeout(t);
    }
  }, [checkoutNotice]);

  async function handleBuyCredits(e) {
    e.preventDefault();
    setBuyError(null);
    if (!buyAmount || Number(buyAmount) < 5) {
      setBuyError('Enter at least $5.00.');
      return;
    }
    setBuyBusy(true);
    try {
      const res = await fetch('/api/ads/buy-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountDollars: buyAmount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
      window.location.href = data.url;
    } catch (err) {
      setBuyError(err.message);
      setBuyBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Ad Manager — {SITE.name}</title>
      </Head>
      <AdManagerNav companyName={adAccount.companyName} />

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Ad Manager</div>

        {checkoutNotice && (
          <div className="account-card" style={{ maxWidth: 'none', marginBottom: '1rem', borderLeft: '3px solid var(--sky)' }}>
            <p style={{ margin: 0, fontSize: '0.88rem' }}>{checkoutNotice}</p>
          </div>
        )}

        <div className="account-card ad-manager-account-card" style={{ maxWidth: 'none', marginBottom: '1.5rem' }}>
          <h3>Ad credits</h3>
          <p style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.2rem 0 0.8rem' }}>
            {centsToDollars(adAccount.creditBalanceCents)} <span style={{ fontSize: '0.85rem', fontWeight: 'normal', color: 'var(--ink-dim)' }}>available</span>
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
            This balance is shared across every approved ad on your account — buy once, and any ad
            you run draws from it until it&rsquo;s gone. Add more anytime.
          </p>
          <form onSubmit={handleBuyCredits} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <input
              type="number"
              min="5"
              step="1"
              placeholder="25.00"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              style={{ maxWidth: '140px' }}
            />
            <button className="unlock-btn" type="submit" disabled={buyBusy} style={{ width: 'auto' }}>
              {buyBusy ? 'Redirecting…' : 'Add credits'}
            </button>
          </form>
          {buyError && <div className="house-ad-error">{buyError}</div>}
        </div>

        <div className="account-card ad-manager-account-card" style={{ maxWidth: 'none', marginBottom: '1.5rem' }}>
          <h3>Submit a new ad</h3>
          <AdvertiserAdForm onSubmitted={handleAdSubmitted} />
        </div>

        <div className="account-card ad-manager-account-card" style={{ maxWidth: 'none' }}>
          <h3>Your ads</h3>
          {ads.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)' }}>Nothing submitted yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {ads.map((ad) => (
                <div key={ad.id} style={{ padding: '0.8rem 1rem', borderRadius: '10px', background: 'var(--surface-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold' }}>{ad.title}</span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        color: ad.reviewStatus === 'approved' ? 'var(--ok)' : ad.reviewStatus === 'rejected' ? 'var(--danger)' : 'var(--brass)'
                      }}
                    >
                      {STATUS_LABEL[ad.reviewStatus] || ad.reviewStatus}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.3rem' }}>
                    {ad.impressions} impressions · {ad.clicks} clicks
                    {' · '}
                    {ad.budgetTotalCents != null
                      ? <>{centsToDollars(ad.budgetSpentCents)} of {centsToDollars(ad.budgetTotalCents)} cap spent</>
                      : <>{centsToDollars(ad.budgetSpentCents)} spent, no per-ad cap</>}
                  </div>
                  {ad.reviewStatus === 'approved' && !ad.active && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>
                      Paused — {ad.budgetTotalCents != null && ad.budgetSpentCents >= ad.budgetTotalCents
                        ? 'this ad\u2019s own cap has been reached.'
                        : 'add credits above to resume.'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <AdManagerFooter />
    </>
  );
}
