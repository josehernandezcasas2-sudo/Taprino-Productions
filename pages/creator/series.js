import { useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../../lib/accountContext';
import { getAllSeriesForCreator } from '../../lib/series';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import HeaderNav from '../../components/HeaderNav';
import InstallButton from '../../components/InstallButton';
import SeriesMediaForm from '../../components/SeriesMediaForm';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import RequestEditModal from '../../components/RequestEditModal';
import { SITE } from '../../lib/siteConfig';

import Footer from '../../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeriesForCreator(), getPublicEpisodes()]);
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      allSeries,
      mainGenres,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function SeriesManagement({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [seriesList, setSeriesList] = useState(allSeries);
  const [deletingSeries, setDeletingSeries] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [editingNameDesc, setEditingNameDesc] = useState(null);
  // Bumping this forces SeriesMediaForm to remount with fresh initial
  // props (via the key trick below) — simpler and safer than converting
  // its internal mode/seriesId state to be fully controlled from here,
  // for what's just a "jump down and pre-select" interaction.
  const [mediaFormTarget, setMediaFormTarget] = useState(null); // { seriesId, bump }
  const mediaFormRef = useRef(null);

  function openMediaFormFor(seriesId) {
    setOpenDropdown(null);
    setMediaFormTarget((prev) => ({ seriesId, bump: (prev?.bump || 0) + 1 }));
    requestAnimationFrame(() => {
      mediaFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function refreshSeriesList() {
    try {
      const res = await fetch('/api/creator/list-series');
      const data = await res.json();
      if (res.ok) setSeriesList(data.series);
    } catch (err) {
      // Leave the list as-is on a failed refresh.
    }
  }

  async function requestDeletion(reason) {
    const res = await fetch('/api/creator/request-series-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId: deletingSeries.id, action: 'request', reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit the request.');
    setDeletingSeries(null);
    refreshSeriesList();
  }

  async function cancelDeletion(seriesId) {
    setActionError(null);
    try {
      const res = await fetch('/api/creator/request-series-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId, action: 'cancel' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel the request.');
      refreshSeriesList();
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <>
      <Head>
        <title>Series — {SITE.name}</title>
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

      <main id="main-content" className="stage" style={{ gridTemplateColumns: '1fr', maxWidth: '720px' }}>
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Series management</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>
          Set shared trailer and artwork per series, or request a series be removed.
          For uploading shorts and episodes, head to <Link href="/creator" style={{ color: 'var(--signal-amber)' }}>Creator Studio</Link>.
        </p>

        <div ref={mediaFormRef}>
          <SeriesMediaForm
            key={mediaFormTarget ? `${mediaFormTarget.seriesId}-${mediaFormTarget.bump}` : 'default'}
            allSeries={seriesList}
            onSaved={refreshSeriesList}
            initialMode={mediaFormTarget ? 'existing' : undefined}
            initialSeriesId={mediaFormTarget ? mediaFormTarget.seriesId : undefined}
          />
        </div>

        <div className="account-card" style={{ marginTop: '1.5rem' }}>
          <div className="account-eyebrow">All series</div>
          <h3>Status and deletion requests</h3>

          {actionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{actionError}</p>}

          {seriesList.length === 0 && <p>No series yet — create one above.</p>}

          {seriesList.map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid rgba(234,231,221,0.1)', padding: '0.9rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h4 style={{ margin: '0 0 0.3rem' }}>{s.name}</h4>
                <span style={{ position: 'relative' }}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === s.id ? null : s.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.9rem' }}
                    aria-label={`Settings for ${s.name}`}
                  >
                    ⚙
                  </button>
                  {openDropdown === s.id && (
                    <div className="dropdown dropdown-left open">
                      <button
                        className="dropdown-item"
                        onClick={() => { setEditingNameDesc(s); setOpenDropdown(null); }}
                      >
                        ✎ Edit name &amp; description
                      </button>
                      <button className="dropdown-item" onClick={() => openMediaFormFor(s.id)}>
                        🖼 Edit images &amp; trailer
                      </button>
                    </div>
                  )}
                </span>
              </div>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                Poster {s.poster ? '✓' : '—'} · Thumbnail {s.thumbnail ? '✓' : '—'} · Hero image {s.heroImage ? '✓' : '—'} · Trailer {s.trailerSrc ? '✓' : '—'}
              </p>
              {(s.pendingPoster || s.pendingThumbnail || s.pendingHeroImage || s.pendingTrailerSrc) && (
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--signal-amber)' }}>
                  ⏳ A change is awaiting admin approval and hasn&rsquo;t gone live yet.
                </p>
              )}
              {(s.pendingName || s.pendingDescription) && (
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--signal-amber)' }}>
                  ⏳ A name/description change is awaiting admin approval.
                </p>
              )}

              {s.deletionRequested ? (
                <>
                  <p style={{ fontSize: '0.8rem', color: 'var(--signal-amber)', margin: '0 0 0.4rem' }}>
                    Pending deletion — reason: {s.deletionReason}
                  </p>
                  <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => cancelDeletion(s.id)}>
                    Cancel deletion request
                  </button>
                </>
              ) : (
                <button className="account-btn-secondary" style={{ width: 'auto' }} onClick={() => setDeletingSeries(s)}>
                  Request deletion
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
      <Footer />

      {deletingSeries && (
        <DeleteRequestModal
          itemLabel={deletingSeries.name}
          onClose={() => setDeletingSeries(null)}
          onConfirm={requestDeletion}
        />
      )}

      {editingNameDesc && (
        <RequestEditModal
          type="series"
          currentValues={{ id: editingNameDesc.id, name: editingNameDesc.name, description: editingNameDesc.desc || '' }}
          onClose={() => setEditingNameDesc(null)}
          onSubmitted={refreshSeriesList}
        />
      )}
    </>
  );
}
