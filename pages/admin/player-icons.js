import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import { PlayIcon, PauseIcon, VolumeIcon, SettingsIcon, FullscreenIcon, SearchIcon, BellIcon, InfoIcon, HeartIcon, LockIcon, SparkleIcon, TargetIcon, CardIcon, BarChartIcon, ClapperboardIcon, FolderIcon, LogoutIcon, ArrowRightIcon, DiamondIcon, SeriesListIcon, AccountIcon, SkipBackIcon, SkipForwardIcon, CloseIcon, TeamIcon, TvIcon, LiveDotIcon, AntennaIcon, InboxIcon, ImageIcon, SlidersIcon, CalendarIcon, PaletteIcon, HeadphonesIcon, ChatIcon, TrashIcon, WarningIcon, ClockIcon, PencilIcon, EyeIcon, UndoIcon, ExternalLinkIcon, LinkIcon } from '../../components/PlayerIcons';

// Each entry: the icon_key stored in the database, a human label for the
// admin UI, and the default SVG to show as a live preview alongside
// whatever's currently uploaded (or in place of it, once reset).
const ICON_DEFS = [
  { key: 'play', label: 'Play', Default: () => <PlayIcon size={22} /> },
  { key: 'pause', label: 'Pause', Default: () => <PauseIcon size={22} /> },
  { key: 'volume_on', label: 'Volume (on)', Default: () => <VolumeIcon size={22} muted={false} /> },
  { key: 'volume_muted', label: 'Volume (muted)', Default: () => <VolumeIcon size={22} muted /> },
  { key: 'settings', label: 'Settings gear', Default: () => <SettingsIcon size={22} /> },
  { key: 'fullscreen_enter', label: 'Fullscreen (enter)', Default: () => <FullscreenIcon size={22} expanded={false} /> },
  { key: 'fullscreen_exit', label: 'Fullscreen (exit)', Default: () => <FullscreenIcon size={22} expanded /> },
  { key: 'search', label: 'Search', Default: () => <SearchIcon size={22} /> },
  { key: 'notification', label: 'Notification bell', Default: () => <BellIcon size={22} /> },
  { key: 'info', label: '"More info"', Default: () => <InfoIcon size={22} /> },
  { key: 'heart_active', label: 'Wishlist (saved)', Default: () => <HeartIcon size={22} active /> },
  { key: 'heart_inactive', label: 'Wishlist (not saved)', Default: () => <HeartIcon size={22} active={false} /> },
  { key: 'admin_lock', label: 'Admin portal', Default: () => <LockIcon size={22} /> },
  { key: 'sparkle', label: 'Recs / upgrade', Default: () => <SparkleIcon size={22} /> },
  { key: 'target', label: 'Pitch Room', Default: () => <TargetIcon size={22} /> },
  { key: 'card', label: 'Manage subscription', Default: () => <CardIcon size={22} /> },
  { key: 'bar_chart', label: 'Creator analytics', Default: () => <BarChartIcon size={22} /> },
  { key: 'clapperboard', label: 'Submit / become a creator', Default: () => <ClapperboardIcon size={22} /> },
  { key: 'folder', label: 'Your work', Default: () => <FolderIcon size={22} /> },
  { key: 'logout', label: 'Sign out', Default: () => <LogoutIcon size={22} /> },
  { key: 'arrow_right', label: 'Log in', Default: () => <ArrowRightIcon size={22} /> },
  { key: 'tab_home', label: 'Mobile tab bar — Home', Default: () => <DiamondIcon size={22} /> },
  { key: 'tab_series', label: 'Mobile tab bar — Series', Default: () => <SeriesListIcon size={22} /> },
  { key: 'tab_account', label: 'Mobile tab bar — Account', Default: () => <AccountIcon size={22} /> },
  { key: 'skip_back', label: 'Podcast player — skip back 15s', Default: () => <SkipBackIcon size={22} /> },
  { key: 'skip_forward', label: 'Podcast player — skip forward 30s', Default: () => <SkipForwardIcon size={22} /> },
  { key: 'close', label: 'Podcast player — close', Default: () => <CloseIcon size={22} /> },
  { key: 'team', label: 'Admin nav — Team & permissions', Default: () => <TeamIcon size={22} /> },
  { key: 'tv', label: 'Admin nav — House ads', Default: () => <TvIcon size={22} /> },
  { key: 'live_dot', label: 'Admin nav — Go live', Default: () => <LiveDotIcon size={22} /> },
  { key: 'antenna', label: 'Admin nav — Channel schedule', Default: () => <AntennaIcon size={22} /> },
  { key: 'inbox', label: 'Admin nav — Applications', Default: () => <InboxIcon size={22} /> },
  { key: 'image', label: 'Admin nav — Genre icons', Default: () => <ImageIcon size={22} /> },
  { key: 'sliders', label: 'Admin nav — Icons page', Default: () => <SlidersIcon size={22} /> },
  { key: 'calendar', label: 'Admin nav — Content lifecycle', Default: () => <CalendarIcon size={22} /> },
  { key: 'palette', label: 'Admin nav — Theme colors', Default: () => <PaletteIcon size={22} /> },
  { key: 'headphones', label: 'Creator dashboard — has audio / podcast', Default: () => <HeadphonesIcon size={22} /> },
  { key: 'chat', label: 'Creator dashboard — captions', Default: () => <ChatIcon size={22} /> },
  { key: 'trash', label: 'Creator dashboard — delete', Default: () => <TrashIcon size={22} /> },
  { key: 'warning', label: 'Creator dashboard — needs attention', Default: () => <WarningIcon size={22} /> },
  { key: 'clock', label: 'Creator dashboard — pending', Default: () => <ClockIcon size={22} /> },
  { key: 'pencil', label: 'Creator dashboard — edit', Default: () => <PencilIcon size={22} /> },
  { key: 'eye', label: 'Creator dashboard — view count', Default: () => <EyeIcon size={22} /> },
  { key: 'undo', label: 'Creator dashboard — cancel deletion', Default: () => <UndoIcon size={22} /> },
  { key: 'external_link', label: 'Creator dashboard — view public page', Default: () => <ExternalLinkIcon size={22} /> },
  { key: 'link', label: 'Creator dashboard — copy link', Default: () => <LinkIcon size={22} /> }
];

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

export default function PlayerIconsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [icons, setIcons] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/player-icons');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons(Object.fromEntries(data.icons.map((i) => [i.icon_key, i.image_url])));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function readAsDataUrl(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(f);
    });
  }

  async function upload(iconKey, file) {
    setBusy(iconKey);
    setError(null);
    try {
      const imageBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/player-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iconKey, imageBase64, imageFileName: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => ({ ...prev, [iconKey]: data.imageUrl }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reset(iconKey) {
    setBusy(iconKey);
    setError(null);
    try {
      const res = await fetch('/api/admin/player-icons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iconKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => {
        const next = { ...prev };
        delete next[iconKey];
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Head>
        <title>Icons — Admin</title>
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
        <div className="ca-head">
          <div>
            <div className="eyebrow">Admin</div>
            <h1>Icons</h1>
            <p className="ca-sub">
              Replace any of these icons with an uploaded image — the video player&rsquo;s controls, plus
              search, notifications, &ldquo;More info,&rdquo; and the wishlist heart everywhere they appear
              across the site. Icons left alone keep showing the default — nothing changes until you
              upload something for it.
            </p>
            <p className="ca-sub">
              <strong>Note:</strong> Search previously had its own separate upload field on the main
              Site Settings page. That old field still technically works, but this page now takes
              priority over it — upload here going forward rather than there.
            </p>
            <div style={{ background: 'rgba(217,143,62,0.1)', border: '1px solid rgba(217,143,62,0.3)', borderRadius: 8, padding: '0.9rem 1rem', margin: '0.8rem 0' }}>
              <strong>Sizing recommendation:</strong> square images, at least 64×64px (128×128px or
              larger holds up better on high-density/retina screens). Transparent PNG or SVG works
              best — these render small (typically 18–32px), so simple, bold shapes read far more
              clearly than fine detail or thin lines, which tend to blur or disappear at that size.
            </div>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="genre-icon-grid">
          {ICON_DEFS.map(({ key, label, Default }) => (
            <div key={key} className="genre-icon-card">
              <div className="genre-icon-preview" style={{ background: '#0f0f0a', color: '#eae7dd' }}>
                {icons[key] ? (
                  <img src={icons[key]} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
                ) : (
                  <Default />
                )}
              </div>
              <div className="genre-icon-name">{label}</div>
              <div className="genre-icon-state">{icons[key] ? 'Custom image' : 'Default icon'}</div>
              <div className="genre-icon-actions">
                <label className="admin-media-action">
                  {busy === key ? 'Uploading…' : icons[key] ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy === key}
                    onChange={(e) => e.target.files[0] && upload(key, e.target.files[0])}
                  />
                </label>
                {icons[key] && (
                  <button type="button" className="admin-media-undo" onClick={() => reset(key)} disabled={busy === key}>
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
