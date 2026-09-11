import { useState } from 'react';
import Head from 'next/head';
import { SignInButton } from '@clerk/nextjs';
import { getAccountContext } from '../lib/accountContext';
import { getOwnAdAccount, getAdsForAccount } from '../lib/adAccounts';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import Footer from '../components/Footer';
import AdvertiserAdForm from '../components/AdvertiserAdForm';
import { SITE } from '../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);

  let adAccount = null;
  let ads = [];
  if (account.isSignedIn) {
    adAccount = await getOwnAdAccount(account.userId);
    if (adAccount) {
      ads = await getAdsForAccount(adAccount.id);
    }
  }

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      adAccount,
      ads
    }
  };
}

const STATUS_LABEL = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected'
};

function centsToDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function Advertise({ isSignedIn, isSubscriber, email, isAdmin, isCreator, adAccount: initialAdAccount, ads: initialAds }) {
  const [adAccount, setAdAccount] = useState(initialAdAccount);
  const [ads, setAds] = useState(initialAds);
  const [companyName, setCompanyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupError, setSignupError] = useState(null);

  async function handleSignup(e) {
    e.preventDefault();
    setSignupError(null);
    setSignupBusy(true);
    try {
      const res = await fetch('/api/ads/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, contactEmail: contactEmail || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create your ad account.');
      setAdAccount(data.account);
    } catch (err) {
      setSignupError(err.message);
    } finally {
      setSignupBusy(false);
    }
  }

  function handleAdSubmitted(newAd) {
    setAds((prev) => [newAd, ...prev]);
  }

  const [budgetInputs, setBudgetInputs] = useState({});
  const [budgetBusyId, setBudgetBusyId] = useState(null);
  const [budgetErrors, setBudgetErrors] = useState({});

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
        <title>Advertise — {SITE.name}</title>
      </Head>
      <HeaderNav mainGenres={[]} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <div className="install-row"><InstallButton /></div>

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Advertise on {SITE.name}</div>

        {!isSignedIn && (
          <div className="account-card" style={{ maxWidth: 'none' }}>
            <p style={{ marginBottom: '1rem' }}>Sign in to create an ad account and submit ads for review.</p>
            <SignInButton mode="modal">
              <button className="unlock-btn">Sign in</button>
            </SignInButton>
          </div>
        )}

        {isSignedIn && !adAccount && (
          <div className="account-card" style={{ maxWidth: 'none' }}>
            <h3>Create your ad account</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1rem' }}>
              Once created, you can upload ad creative, set your own budget, and submit for admin
              review before anything goes live.
            </p>
            <form onSubmit={handleSignup}>
              <label>Company name</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />

              <label>Contact email <span style={{ fontWeight: 'normal', opacity: 0.65 }}>optional — defaults to your account email</span></label>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder={email || ''} />

              {signupError && <div className="house-ad-error">{signupError}</div>}

              <button className="unlock-btn" type="submit" disabled={signupBusy} style={{ marginTop: '1rem' }}>
                {signupBusy ? 'Creating…' : 'Create ad account'}
              </button>
            </form>
          </div>
        )}

        {isSignedIn && adAccount && (
          <>
            <div className="account-card" style={{ maxWidth: 'none', marginBottom: '1.5rem' }}>
              <h3>Submit a new ad</h3>
              <AdvertiserAdForm onSubmitted={handleAdSubmitted} />
            </div>

            <div className="account-card" style={{ maxWidth: 'none' }}>
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
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
