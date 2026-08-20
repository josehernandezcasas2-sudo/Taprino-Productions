import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import MobileTabBar from '../../components/MobileTabBar';
import HouseAdForm from '../../components/HouseAdForm';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
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

function ctr(ad) {
  if (!ad.impressions) return null;
  return ((ad.clicks / ad.impressions) * 100).toFixed(1);
}

export default function HouseAdsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [ads, setAds] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/admin/house-ads');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAds(data.ads);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(ad) {
    setBusyId(ad.id);
    try {
      const res = await fetch('/api/admin/house-ads-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ad.id, action: 'toggle' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAds((prev) => prev.map((a) => (a.id === ad.id ? data.ad : a)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(ad) {
    if (!window.confirm(`Delete "${ad.title}"? This can't be undone.`)) return;
    setBusyId(ad.id);
    try {
      const res = await fetch('/api/admin/house-ads-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ad.id, action: 'delete' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAds((prev) => prev.filter((a) => a.id !== ad.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = ads ? ads.filter((a) => a.active).length : 0;
  const totalImpressions = ads ? ads.reduce((s, a) => s + a.impressions, 0) : 0;
  const totalClicks = ads ? ads.reduce((s, a) => s + a.clicks, 0) : 0;

  return (
    <>
      <Head>
        <title>House ads — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="stage stage-single">
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>House ads</h1>
            <p className="ca-sub">
              Your own ad system — no network, no approval process, no minimum traffic. Free episodes
              play whichever active ad wins the rotation below.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        <div className="house-ad-notice">
          Point at this system by leaving <code>NEXT_PUBLIC_AD_TAG_URL</code> unset — the player
          defaults to <code>/api/house-ads/vast</code> automatically. Set that variable only once you
          want to switch to a real ad network instead.
        </div>

        {ads && (
          <div className="ca-stats">
            <div className="ca-stat"><b>{activeCount}</b><small>Active ads</small></div>
            <div className="ca-stat"><b>{ads.length}</b><small>Total ads</small></div>
            <div className="ca-stat"><b>{totalImpressions.toLocaleString()}</b><small>Impressions</small></div>
            <div className="ca-stat"><b>{totalClicks.toLocaleString()}</b><small>Clicks</small></div>
          </div>
        )}

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="eyebrow ca-section">
          {showForm ? 'New ad' : 'Your ads'}
        </div>

        {!showForm && (
          <button className="account-btn-primary" onClick={() => setShowForm(true)} style={{ marginBottom: '1.2rem' }}>
            + Add a house ad
          </button>
        )}

        {showForm && (
          <div className="house-ad-form-wrap">
            <HouseAdForm
              onCreated={(ad) => {
                setAds((prev) => [ad, ...(prev || [])]);
                setShowForm(false);
              }}
            />
            <button className="upload-widget-dismiss" onClick={() => setShowForm(false)} style={{ marginTop: '0.6rem' }}>
              Cancel
            </button>
          </div>
        )}

        {!ads && !error && <div className="ca-empty">Loading your ads…</div>}

        {ads && ads.length === 0 && !showForm && (
          <div className="ca-empty">
            No house ads yet. Free episodes will play with no pre-roll until you add one — that&rsquo;s
            a safe default, not an error.
          </div>
        )}

        {ads && ads.length > 0 && (
          <div className="house-ad-list">
            {ads.map((ad) => (
              <div key={ad.id} className={`house-ad-card ${ad.active ? '' : 'paused'}`}>
                <video src={ad.video_url} className="house-ad-preview" muted playsInline preload="metadata" />
                <div className="house-ad-info">
                  <div className="house-ad-title">{ad.title}</div>
                  <div className="house-ad-meta">
                    {ad.advertiser ? `${ad.advertiser} · ` : ''}
                    {Math.round(ad.duration_seconds)}s · {ad.width}×{ad.height} · weight {ad.weight}
                  </div>
                  <div className="house-ad-meta">
                    {ad.impressions.toLocaleString()} impressions · {ad.clicks.toLocaleString()} clicks
                    {ctr(ad) !== null && ` · ${ctr(ad)}% CTR`}
                  </div>
                  <a href={ad.click_url} target="_blank" rel="noopener noreferrer" className="house-ad-link">
                    {ad.click_url}
                  </a>
                </div>
                <div className="house-ad-actions">
                  <span className={`b ${ad.active ? 'ok' : 'warn'}`}>{ad.active ? 'Active' : 'Paused'}</span>
                  <button onClick={() => toggle(ad)} disabled={busyId === ad.id}>
                    {ad.active ? 'Pause' : 'Activate'}
                  </button>
                  <button onClick={() => remove(ad)} disabled={busyId === ad.id} className="house-ad-remove">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
