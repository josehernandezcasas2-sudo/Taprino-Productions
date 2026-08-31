import { useState } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getSiteSettings } from '../../lib/siteSettings';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { SITE } from '../../lib/siteConfig';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [episodes, siteSettings] = await Promise.all([getPublicEpisodes(), getSiteSettings()]);
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      faviconUrl: siteSettings.faviconUrl,
      appIconUrl: siteSettings.appIconUrl
    }
  };
}

const ICON_DEFS = [
  {
    target: 'favicon',
    label: 'Favicon',
    hint: 'Shows in the browser tab. Square, works well as small as 32\u00d732px \u2014 SVG stays sharp at any size; PNG needs to already be small and simple to read clearly.'
  },
  {
    target: 'appIcon',
    label: 'App icon',
    hint: 'Shows when someone adds the site to their phone or desktop home screen. Square, at least 512\u00d7512px if using PNG \u2014 SVG scales automatically.'
  }
];

function readAsDataUrl(f) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(f);
  });
}

export default function SiteIconsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator, faviconUrl, appIconUrl }) {
  const [icons, setIcons] = useState({ favicon: faviconUrl, appIcon: appIconUrl });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function upload(target, file) {
    setBusy(target);
    setError(null);
    try {
      const imageBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/site-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, imageBase64, imageFileName: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => ({ ...prev, [target]: data.imageUrl }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reset(target) {
    setBusy(target);
    setError(null);
    try {
      const res = await fetch('/api/admin/site-icons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => ({ ...prev, [target]: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Head>
        <title>Site icons — {SITE.name}</title>
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

      <main id="main-content" className="stage stage-single">
        <div className="eyebrow">Admin</div>
        <h1>Site icons</h1>
        <p className="ca-sub">
          The favicon and app icon shown across every browser tab and home-screen install of{' '}
          {SITE.name}. Changes apply immediately to new page loads &mdash; browsers can hold onto
          the old favicon for a while regardless, since that&rsquo;s cached more aggressively than
          almost anything else on a site.
        </p>

        {error && (
          <div className="ca-empty ca-error" style={{ marginTop: '1rem', textAlign: 'left', padding: '0.8rem 1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginTop: '1.2rem' }}>
          {ICON_DEFS.map((def) => (
            <div key={def.target} className="account-card">
              <div className="account-eyebrow">{def.label}</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.8rem 0' }}>
                <div
                  style={{
                    width: '64px', height: '64px', borderRadius: '10px',
                    background: 'var(--surface-1)', border: '1px solid rgba(234,231,221,0.14)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden'
                  }}
                >
                  <img
                    src={icons[def.target] || '/icon.svg'}
                    alt={`Current ${def.label.toLowerCase()}`}
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-dim)' }}>
                  {icons[def.target] ? 'Custom image uploaded.' : 'Using the site default (/icon.svg).'}
                </p>
              </div>

              <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', marginBottom: '0.9rem' }}>{def.hint}</p>

              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <label className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block', cursor: 'pointer', textAlign: 'center' }}>
                  {busy === def.target ? 'Uploading\u2026' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/svg+xml,image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    disabled={busy === def.target}
                    onChange={(e) => { if (e.target.files[0]) upload(def.target, e.target.files[0]); e.target.value = ''; }}
                  />
                </label>
                {icons[def.target] && (
                  <button
                    onClick={() => reset(def.target)}
                    disabled={busy === def.target}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
