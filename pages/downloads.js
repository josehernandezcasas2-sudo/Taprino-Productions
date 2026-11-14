import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import BackButton from '../components/BackButton';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { SITE } from '../lib/siteConfig';
import { DOWNLOAD_WORDS, MAX_DEVICES, MAX_TITLES_PER_DEVICE, planCarriesDownloads } from '../lib/downloadRules';
import { copiesLabel, deviceLabel, lastSeenLabel } from '../lib/downloadSiteRules';

// /downloads (Jose, 2026-11-14; the first row of the tab bar's Watch menu
// while the admin switch is on): downloads live in the app, and a browser
// can't keep a title for offline viewing, so this page says so and, for a
// signed-in person, lists the phones that hold their downloads (name, how
// many titles, last online) with "Remove this phone". A removed phone
// hears it at its next check-in and deletes its copies
// (lib/downloads.js removePhone). A Stream-side page (lib/streamSection.js).
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { getDownloadsPage } = await import('../lib/downloads');
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  const page = await getDownloadsPage(account);
  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email || null,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      // Whether this account's plan carries downloads (Premium, Sponsor,
      // the team): everyone else gets the link to the plans.
      carries: planCarriesDownloads({ tier: account.tier || 'basic', isAdmin: account.isAdmin }),
      enabled: page.enabled,
      ready: page.ready,
      phones: page.phones
    }
  };
}

export default function Downloads({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres = [], carries = false, enabled, ready, phones = [] }) {
  const [list, setList] = useState(phones);
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function remove(phone) {
    setBusy(phone.deviceId);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/downloads/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: phone.deviceId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t remove that phone. Try again.');
      setList(Array.isArray(data.devices) ? data.devices : list.filter((p) => p.deviceId !== phone.deviceId));
      setDone(`${deviceLabel(phone)} was removed. Its downloads go the next time it connects.`);
      setAsking(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Head>
        <title>{`${DOWNLOAD_WORDS.nav} — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        isSubscriber={isSubscriber}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
      />
      <main id="main-content" className="stage stage-single acct-stage">
        <BackButton fallbackHref="/stream" />
        <div className="acct-title-row">
          <h1 className="acct-title">{DOWNLOAD_WORDS.nav}</h1>
        </div>
        <p className="acct-lede">{DOWNLOAD_WORDS.webOnly}</p>
        <div className="acct-body">
          <div className="account-card">
            <div className="account-subheading">In the app</div>
            {enabled ? (
              <p>
                {DOWNLOAD_WORDS.planBody} A title you bought can be kept too. Open a title in the app and press {DOWNLOAD_WORDS.button}:
                up to {MAX_TITLES_PER_DEVICE} titles on a phone, on {MAX_DEVICES} phones.
              </p>
            ) : (
              <p>{DOWNLOAD_WORDS.off}</p>
            )}
            {enabled && isSignedIn && !carries && (
              <p className="account-fineprint"><Link href="/account/membership">{DOWNLOAD_WORDS.planAction}</Link></p>
            )}
          </div>

          <div className="account-card" data-testid="downloads-phones">
            <div className="account-subheading">Your phones</div>
            {!isSignedIn ? (
              <p><Link href="/account">Sign in</Link> to see the phones that hold your downloads.</p>
            ) : !ready ? (
              <p>The list isn&rsquo;t available right now.</p>
            ) : list.length === 0 ? (
              <p>No phone holds a download of yours right now.</p>
            ) : (
              list.map((phone) => (
                <div className="account-row" key={phone.deviceId} data-testid="downloads-phone">
                  <div>
                    <div className="account-row-label">{deviceLabel(phone)}</div>
                    <div className="account-row-detail">{copiesLabel(phone.count)} · {lastSeenLabel(phone.lastSeenAt)}</div>
                  </div>
                  {asking === phone.deviceId ? (
                    <span>
                      <button type="button" className="account-btn-secondary" disabled={busy === phone.deviceId} onClick={() => remove(phone)}>{busy === phone.deviceId ? 'Removing…' : 'Remove'}</button>{' '}
                      <button type="button" className="account-btn-secondary" disabled={busy === phone.deviceId} onClick={() => setAsking(null)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className="account-btn-secondary" onClick={() => { setAsking(phone.deviceId); setError(null); setDone(null); }}>Remove this phone</button>
                  )}
                </div>
              ))
            )}
            {isSignedIn && ready && list.length > 0 && (
              <p className="account-fineprint" style={{ marginTop: '0.6rem' }}>Removing a phone takes its downloads off it the next time it connects, and frees its place for another phone.</p>
            )}
            {done && <p className="account-fineprint" role="status">{done}</p>}
            {error && <p className="account-fineprint" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
          </div>
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
