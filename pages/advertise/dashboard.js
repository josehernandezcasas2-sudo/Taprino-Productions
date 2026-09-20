import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount, getAdsForAccount } from '../../lib/adAccounts';
import { getSiteSettings } from '../../lib/siteSettings';
import AdManagerNav from '../../components/AdManagerNav';
import AdManagerFooter from '../../components/AdManagerFooter';
import AdvertiserAdForm from '../../components/AdvertiserAdForm';
import AdvertiserEditAdModal from '../../components/AdvertiserEditAdModal';
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
  const { adCpmCents } = await getSiteSettings();
  return { props: { adAccount, ads, adCpmCents } };
}

const STATUS_LABEL = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
};

const STATUS_COLOR = {
  approved: 'var(--ok)',
  rejected: 'var(--danger)',
  pending: 'var(--brass)',
  withdrawn: 'var(--ink-faint)'
};

function centsToDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// A simple inline sparkline — no chart library needed for 14 points.
// The `max(..., 1)` floor avoids a divide-by-zero for a brand-new ad
// with no impressions yet — that series renders as a flat line along
// the bottom, which reads correctly as "zero," not as a broken chart.
function Sparkline({ series }) {
  const width = 200;
  const height = 32;
  const values = series.map((d) => d.count);
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke="var(--sky)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TrendLabel({ last7, prior7 }) {
  if (prior7 === 0 && last7 === 0) return <span style={{ color: 'var(--ink-faint)' }}>No impressions yet</span>;
  if (prior7 === 0) return <span style={{ color: 'var(--ok)' }}>New this week</span>;
  const pct = Math.round(((last7 - prior7) / prior7) * 100);
  if (pct === 0) return <span style={{ color: 'var(--ink-dim)' }}>Flat vs. last week</span>;
  const up = pct > 0;
  return (
    <span style={{ color: up ? 'var(--ok)' : 'var(--danger)' }}>
      {up ? '↑' : '↓'} {Math.abs(pct)}% vs. last week
    </span>
  );
}

export default function AdManagerDashboard({ adAccount: initialAdAccount, ads: initialAds, adCpmCents }) {
  const router = useRouter();
  const [adAccount, setAdAccount] = useState(initialAdAccount);
  const [ads, setAds] = useState(initialAds);
  const [buyAmount, setBuyAmount] = useState('');
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyError, setBuyError] = useState(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [editingAd, setEditingAd] = useState(null);
  const [adActionBusyId, setAdActionBusyId] = useState(null);
  const [adActionErrors, setAdActionErrors] = useState({});
  const [performanceByAd, setPerformanceByAd] = useState({});
  const [performanceConfigured, setPerformanceConfigured] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ads/performance')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.configured === false) {
          setPerformanceConfigured(false);
        } else {
          setPerformanceByAd(data.byAd || {});
        }
      })
      .catch(() => {
        // Silent — performance history is a nice-to-have on top of the
        // lifetime impressions/clicks count already shown, not something
        // the rest of the dashboard depends on.
      });
    return () => { cancelled = true; };
  }, []);

  function handleAdSubmitted(newAd) {
    setAds((prev) => [newAd, ...prev]);
  }

  function handleAdEdited(updatedAd) {
    setAds((prev) => prev.map((a) => (a.id === updatedAd.id ? updatedAd : a)));
  }

  function setAdError(adId, message) {
    setAdActionErrors((prev) => ({ ...prev, [adId]: message }));
  }

  async function handleWithdraw(adId) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Withdraw this ad? This can\'t be undone — you\'d need to submit a new one.')) return;
    setAdError(adId, null);
    setAdActionBusyId(adId);
    try {
      const res = await fetch('/api/ads/withdraw-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not withdraw this ad.');
      setAds((prev) => prev.map((a) => (a.id === adId ? { ...a, reviewStatus: 'withdrawn' } : a)));
    } catch (err) {
      setAdError(adId, err.message);
    } finally {
      setAdActionBusyId(null);
    }
  }

  async function handleTogglePause(adId, currentlyPaused) {
    setAdError(adId, null);
    setAdActionBusyId(adId);
    try {
      const res = await fetch('/api/ads/toggle-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId, paused: !currentlyPaused })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update this ad.');
      setAds((prev) => prev.map((a) => (a.id === adId ? data.ad : a)));
    } catch (err) {
      setAdError(adId, err.message);
    } finally {
      setAdActionBusyId(null);
    }
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

  async function handleRedeemCode(e) {
    e.preventDefault();
    setRedeemError(null);
    setRedeemSuccess(null);
    if (!redeemCode.trim()) {
      setRedeemError('Enter a code first.');
      return;
    }
    setRedeemBusy(true);
    try {
      const res = await fetch('/api/ads/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not redeem that code.');
      setRedeemSuccess(`Added $${(data.amountCents / 100).toFixed(2)} in ad credits.`);
      setRedeemCode('');
      await refreshAccount();
    } catch (err) {
      setRedeemError(err.message);
    } finally {
      setRedeemBusy(false);
    }
  }

  const accountSuspended = adAccount.status !== 'active';

  return (
    <>
      <Head>
        <title>Ad Manager — {SITE.name}</title>
      </Head>
      <AdManagerNav companyName={adAccount.companyName} />

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Ad Manager</div>

        {accountSuspended && (
          <div className="account-card" style={{ maxWidth: 'none', marginBottom: '1rem', borderLeft: '3px solid var(--danger)' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--danger)' }}>Your ad account is suspended</p>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
              You can&rsquo;t submit new ads or buy credits while suspended. Contact support to resolve this.
            </p>
          </div>
        )}

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
              disabled={accountSuspended}
              style={{ maxWidth: '140px' }}
            />
            <button className="unlock-btn" type="submit" disabled={buyBusy || accountSuspended} style={{ width: 'auto' }}>
              {buyBusy ? 'Redirecting…' : 'Add credits'}
            </button>
          </form>
          {buyError && <div className="house-ad-error">{buyError}</div>}

          <form onSubmit={handleRedeemCode} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid rgba(251,232,211,0.1)' }}>
            <input
              type="text"
              placeholder="Have a code? Enter it here"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value)}
              style={{ maxWidth: '220px', fontFamily: 'var(--font-mono)' }}
            />
            <button className="account-btn-secondary" type="submit" disabled={redeemBusy} style={{ width: 'auto' }}>
              {redeemBusy ? 'Redeeming…' : 'Redeem'}
            </button>
          </form>
          {redeemError && <div className="house-ad-error">{redeemError}</div>}
          {redeemSuccess && <div style={{ fontSize: '0.82rem', color: 'var(--ok)', marginTop: '0.4rem' }}>{redeemSuccess}</div>}
        </div>

        <div className="account-card ad-manager-account-card" style={{ maxWidth: 'none', marginBottom: '1.5rem' }}>
          <h3>Submit a new ad</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--ink-dim)', marginBottom: '0.8rem' }}>
            Current rate: <strong style={{ color: 'var(--ink)' }}>${(adCpmCents / 100).toFixed(2)} per 1,000 impressions</strong>
            {' '}— confirmed for this specific ad once admin approves it.
          </p>
          {accountSuspended ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem' }}>Submissions are disabled while your account is suspended.</p>
          ) : (
            <AdvertiserAdForm onSubmitted={handleAdSubmitted} />
          )}
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
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: STATUS_COLOR[ad.reviewStatus] || 'var(--ink-dim)' }}>
                      {STATUS_LABEL[ad.reviewStatus] || ad.reviewStatus}
                    </span>
                  </div>

                  {ad.reviewStatus === 'rejected' && ad.rejectionReason && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: '0.3rem', padding: '0.5rem 0.7rem', background: 'rgba(248,95,115,0.08)', borderRadius: '6px' }}>
                      {ad.rejectionReason}
                    </div>
                  )}

                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.3rem' }}>
                    {ad.impressions} impressions · {ad.clicks} clicks
                    {' · '}
                    {ad.budgetTotalCents != null
                      ? <>{centsToDollars(ad.budgetSpentCents)} of {centsToDollars(ad.budgetTotalCents)} cap spent</>
                      : <>{centsToDollars(ad.budgetSpentCents)} spent, no per-ad cap</>}
                  </div>

                  {ad.reviewStatus === 'approved' && performanceConfigured && performanceByAd[ad.id] && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <Sparkline series={performanceByAd[ad.id].series} />
                      <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        <TrendLabel last7={performanceByAd[ad.id].last7} prior7={performanceByAd[ad.id].prior7} />
                      </div>
                    </div>
                  )}

                  {ad.reviewStatus === 'approved' && !ad.active && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>
                      {ad.pausedByAdvertiser
                        ? 'Paused by you.'
                        : ad.budgetTotalCents != null && ad.budgetSpentCents >= ad.budgetTotalCents
                        ? 'Paused — this ad\u2019s own cap has been reached.'
                        : 'Paused — add credits above to resume.'}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                    {ad.reviewStatus === 'pending' && (
                      <>
                        <button
                          type="button"
                          className="account-btn-secondary"
                          style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => setEditingAd(ad)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="account-btn-secondary"
                          style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.8rem', color: 'var(--danger)' }}
                          onClick={() => handleWithdraw(ad.id)}
                          disabled={adActionBusyId === ad.id}
                        >
                          {adActionBusyId === ad.id ? 'Withdrawing…' : 'Withdraw'}
                        </button>
                      </>
                    )}
                    {ad.reviewStatus === 'approved' && (
                      <button
                        type="button"
                        className="account-btn-secondary"
                        style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => handleTogglePause(ad.id, ad.pausedByAdvertiser)}
                        disabled={adActionBusyId === ad.id}
                      >
                        {adActionBusyId === ad.id
                          ? 'Updating…'
                          : ad.pausedByAdvertiser
                          ? 'Resume'
                          : 'Pause'}
                      </button>
                    )}
                  </div>
                  {adActionErrors[ad.id] && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.3rem' }}>{adActionErrors[ad.id]}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {editingAd && (
        <AdvertiserEditAdModal
          ad={editingAd}
          onClose={() => setEditingAd(null)}
          onSaved={handleAdEdited}
        />
      )}

      <AdManagerFooter />
    </>
  );
}
