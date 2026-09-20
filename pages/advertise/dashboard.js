import { useState } from 'react';
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

export default function AdManagerDashboard({ adAccount, ads: initialAds }) {
  const [ads, setAds] = useState(initialAds);
  const [budgetInputs, setBudgetInputs] = useState({});
  const [budgetBusyId, setBudgetBusyId] = useState(null);
  const [budgetErrors, setBudgetErrors] = useState({});

  function handleAdSubmitted(newAd) {
    setAds((prev) => [newAd, ...prev]);
  }

  async function handleIncreaseBudget(adId) {
    const additionalDollars = budgetInputs[adId];
    if (!additionalDollars || Number(additionalDollars) <= 0) {
      setBudgetErrors((prev) => ({ ...prev, [adId]: 'Enter a positive amount.' }));
      return;
    }
    setBudgetErrors((prev) => ({ ...prev, [adId]: null }));
    setBudgetBusyId(adId);
    try {
      const res = await fetch('/api/ads/increase-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId, additionalDollars })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not increase the budget.');
      setAds((prev) => prev.map((a) => (a.id === adId ? data.ad : a)));
      setBudgetInputs((prev) => ({ ...prev, [adId]: '' }));
    } catch (err) {
      setBudgetErrors((prev) => ({ ...prev, [adId]: err.message }));
    } finally {
      setBudgetBusyId(null);
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
                    {ad.budgetTotalCents != null && (
                      <> · {centsToDollars(ad.budgetSpentCents)} of {centsToDollars(ad.budgetTotalCents)} spent</>
                    )}
                    {ad.reviewStatus === 'approved' && ad.costPerImpressionCents == null && (
                      <> · running free (no rate set yet)</>
                    )}
                  </div>
                  {!ad.active && ad.reviewStatus === 'approved' && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>Paused</div>
                  )}
                  {ad.reviewStatus === 'approved' && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Add $"
                        value={budgetInputs[ad.id] || ''}
                        onChange={(e) => setBudgetInputs((prev) => ({ ...prev, [ad.id]: e.target.value }))}
                        style={{ width: '90px', fontSize: '0.8rem' }}
                      />
                      <button
                        type="button"
                        className="account-btn-secondary"
                        style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        onClick={() => handleIncreaseBudget(ad.id)}
                        disabled={budgetBusyId === ad.id}
                      >
                        {budgetBusyId === ad.id ? 'Adding…' : 'Add to budget'}
                      </button>
                    </div>
                  )}
                  {budgetErrors[ad.id] && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.3rem' }}>{budgetErrors[ad.id]}</div>
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
