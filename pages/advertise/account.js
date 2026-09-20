import { useState } from 'react';
import Head from 'next/head';
import { getAuth } from '@clerk/nextjs/server';
import { getOwnAdAccount } from '../../lib/adAccounts';
import AdManagerNav from '../../components/AdManagerNav';
import AdManagerFooter from '../../components/AdManagerFooter';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/advertise/login', permanent: false } };
  }
  const adAccount = await getOwnAdAccount(userId);
  if (!adAccount) {
    return { redirect: { destination: '/advertise', permanent: false } };
  }
  return { props: { adAccount } };
}

export default function AdManagerAccount({ adAccount: initialAdAccount }) {
  const [adAccount, setAdAccount] = useState(initialAdAccount);
  const [companyName, setCompanyName] = useState(initialAdAccount.companyName);
  const [contactEmail, setContactEmail] = useState(initialAdAccount.contactEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/ads/update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, contactEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save changes.');
      setAdAccount(data.account);
      setSavedAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Ad Manager Account — {SITE.name}</title>
      </Head>
      <AdManagerNav companyName={adAccount.companyName} />

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '560px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Advertiser account</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', marginBottom: '1.2rem' }}>
          This is your advertiser profile — separate from any streaming or creator account tied to
          the same sign-in. Changes here only affect how your ads and account appear to admin
          during review.
        </p>

        <div className="account-card ad-manager-account-card" style={{ maxWidth: 'none' }}>
          <form onSubmit={handleSave}>
            <label>Company name</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />

            <label>Contact email</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />

            <label>Account status</label>
            <input value={adAccount.status === 'active' ? 'Active' : 'Suspended'} readOnly disabled />

            {error && <div className="house-ad-error">{error}</div>}

            <button className="unlock-btn" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {savedAt && !busy && (
              <span style={{ marginLeft: '0.8rem', fontSize: '0.8rem', color: 'var(--ok)' }}>Saved.</span>
            )}
          </form>
        </div>
      </main>

      <AdManagerFooter />
    </>
  );
}
