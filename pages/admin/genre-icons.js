import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';

// Same 10 genres GenreBrowseRow ships default emoji for — kept in sync
// manually since there's no single shared source for this list yet. If a
// new genre is ever added to MAIN_GENRES elsewhere, add it here too.
const GENRES = ['Comedy', 'Action', 'Horror', 'Science Fiction', 'Fantasy', 'Romance', 'Documentary', 'Mystery', 'Animation', 'Anime'];
const DEFAULT_EMOJI = {
  Comedy: '😂', Action: '💥', Horror: '👻', 'Science Fiction': '🛸', Fantasy: '⚔️',
  Romance: '💕', Documentary: '🎬', Mystery: '🔍', Animation: '🎨', Anime: '🌸'
};

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

export default function GenreIconsAdmin({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [icons, setIcons] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/genre-icons');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons(Object.fromEntries(data.icons.map((i) => [i.genre, i.image_url])));
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

  async function upload(genre, file) {
    setBusy(genre);
    setError(null);
    try {
      const imageBase64 = await readAsDataUrl(file);
      const res = await fetch('/api/admin/genre-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, imageBase64, imageFileName: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => ({ ...prev, [genre]: data.imageUrl }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reset(genre) {
    setBusy(genre);
    setError(null);
    try {
      const res = await fetch('/api/admin/genre-icons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIcons((prev) => {
        const next = { ...prev };
        delete next[genre];
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
        <title>Genre icons — Admin</title>
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
            <h1>Genre icons</h1>
            <p className="ca-sub">
              Replace any genre&rsquo;s default emoji with an uploaded image. Genres left alone keep
              showing their emoji — nothing changes until you upload something for it.
            </p>
          </div>
          <Link href="/admin" className="library-back">← Back to admin</Link>
        </div>

        {error && <div className="house-ad-error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="genre-icon-grid">
          {GENRES.map((g) => (
            <div key={g} className="genre-icon-card">
              <div className="genre-icon-preview">
                {icons[g] ? (
                  <img src={icons[g]} alt="" />
                ) : (
                  <span className="genre-icon-emoji">{DEFAULT_EMOJI[g]}</span>
                )}
              </div>
              <div className="genre-icon-name">{g}</div>
              <div className="genre-icon-state">{icons[g] ? 'Custom image' : 'Default emoji'}</div>
              <div className="genre-icon-actions">
                <label className="admin-media-action">
                  {busy === g ? 'Uploading…' : icons[g] ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy === g}
                    onChange={(e) => e.target.files[0] && upload(g, e.target.files[0])}
                  />
                </label>
                {icons[g] && (
                  <button type="button" className="admin-media-undo" onClick={() => reset(g)} disabled={busy === g}>
                    Reset to emoji
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
