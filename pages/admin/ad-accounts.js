import { useState, useEffect } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

function centsToDollars(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export default function AdminAdAccounts({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    try {
      const res = await fetch('/api/admin/ad-accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load ad accounts.');
      setAccounts(data.accounts);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleStatus(account) {
    const nextStatus = account.status === 'active' ? 'suspended' : 'active';
    // eslint-disable-next-line no-alert
    if (nextStatus === 'suspended' && !window.confirm(`Suspend ${account.companyName}? They won't be able to submit ads or buy credits until reactivated.`)) {
      return;
    }
    setBusyId(account.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/ad-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountId: account.id, status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update this account.');
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, status: data.account.status } : a)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const totals = (accounts || []).reduce(
    (acc, a) => ({
      creditBalanceCents: acc.creditBalanceCents + (a.creditBalanceCents || 0),
      totalSpentCents: acc.totalSpentCents + (a.totalSpentCents || 0)
    }),
    { creditBalanceCents: 0, totalSpentCents: 0 }
  );

  return (
    <>
      <Head>
        <title>Ad Accounts — Admin — {SITE.name}</title>
      </Head>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '900px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Ad Accounts</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
          Every advertiser account on the site, with their current credit balance and ad history.
          Suspending an account blocks new submissions and credit purchases immediately — it
          doesn&rsquo;t touch ads already running.
        </p>

        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

        {!accounts ? (
          <p style={{ color: 'var(--ink-dim)' }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <div className="account-card" style={{ maxWidth: 'none', flex: '1 1 200px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>Advertisers</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{accounts.length}</div>
              </div>
              <div className="account-card" style={{ maxWidth: 'none', flex: '1 1 200px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>Credits outstanding</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{centsToDollars(totals.creditBalanceCents)}</div>
              </div>
              <div className="account-card" style={{ maxWidth: 'none', flex: '1 1 200px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>Total ever spent</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{centsToDollars(totals.totalSpentCents)}</div>
              </div>
            </div>

            {accounts.length === 0 ? (
              <p style={{ color: 'var(--ink-dim)' }}>No advertiser accounts yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {accounts.map((account) => (
                  <div key={account.id} style={{ padding: '0.9rem 1.1rem', borderRadius: '10px', background: 'var(--surface-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.8rem' }}>
                      <div>
                        <div style={{ fontWeight: 'bold' }}>{account.companyName}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>{account.contactEmail}</div>
                      </div>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 'bold',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          background: account.status === 'active' ? 'rgba(46,204,113,0.15)' : 'rgba(248,95,115,0.15)',
                          color: account.status === 'active' ? 'var(--ok)' : 'var(--danger)'
                        }}
                      >
                        {account.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.6rem' }}>
                      <span><strong style={{ color: 'var(--ink)' }}>{centsToDollars(account.creditBalanceCents)}</strong> in credits</span>
                      <span><strong style={{ color: 'var(--ink)' }}>{centsToDollars(account.totalSpentCents)}</strong> spent lifetime</span>
                      <span>{account.approved || 0} approved</span>
                      <span>{account.pending || 0} pending</span>
                      <span>{account.rejected || 0} rejected</span>
                    </div>

                    <button
                      type="button"
                      className="account-btn-secondary"
                      style={{ width: 'auto', padding: '0.35rem 0.8rem', fontSize: '0.8rem', marginTop: '0.7rem', color: account.status === 'active' ? 'var(--danger)' : 'var(--ok)' }}
                      onClick={() => toggleStatus(account)}
                      disabled={busyId === account.id}
                    >
                      {busyId === account.id ? 'Updating…' : account.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <MobileTabBar isSignedIn={isSignedIn} isCreator={isCreator} isAdmin={isAdmin} />
      <Footer />
    </>
  );
}
