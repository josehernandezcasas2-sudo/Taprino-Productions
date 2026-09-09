import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getAllSeries } from '../lib/series';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';
import CreatorSubmissionForm from '../components/CreatorSubmissionForm';
import AddSeriesForm from '../components/AddSeriesForm';
import SubmissionModal from '../components/SubmissionModal';

// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(account.userId), getPublicEpisodes()]);
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

// Five type-specific buttons replace the old single generic form with a
// content-type dropdown buried inside it — each opens a popup built for
// just that type, so a podcast submission shows the show/season picker
// and audio import right away, while a film submission never shows
// series-related fields at all. "Add Series" is genuinely different from
// the other four: it creates only a series shell (name/description/
// artwork), no episode, pending admin review — episodes get added to it
// afterward through the normal flow, whenever the creator's ready,
// without waiting on that review.
const TYPE_BUTTONS = [
  { key: 'movie', icon: '\u{1F3AC}', label: 'Add Film' },
  { key: 'series', icon: '\u{1F4FA}', label: 'Add Series' },
  { key: 'podcast', icon: '\u{1F3A7}', label: 'Add Podcast' },
  { key: 'short', icon: '\u26A1', label: 'Add Short' },
  { key: 'vertical', icon: '\u{1F4F1}', label: 'Add Vertical' }
];

const TYPE_TITLES = {
  movie: 'Add Film',
  series: 'Add Series',
  podcast: 'Add Podcast',
  short: 'Add Short',
  vertical: 'Add Vertical'
};

export default function CreatorSubmit({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [openModal, setOpenModal] = useState(null);
  const [seriesCreated, setSeriesCreated] = useState(null);
  // Distinct from openModal==='series' (which opens the "create a new
  // series" form) — this instead opens the episode-submission form
  // pre-targeted at a series that already exists, used by the "Add the
  // first episode now" handoff right after a new series is created.
  const [episodeForSeriesId, setEpisodeForSeriesId] = useState(null);

  function closeModal() {
    setOpenModal(null);
    setEpisodeForSeriesId(null);
    setSeriesCreated(null);
  }

  return (
    <>
      <Head>
        <title>Submit an episode — {SITE.name}</title>
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
        <div className="library-heading" style={{ marginBottom: '0.3rem' }}>Creator Studio</div>
        <p className="library-sub" style={{ marginBottom: '1.2rem' }}>Submit new episodes and track your review status.</p>

        <div className="creator-type-grid">
          {TYPE_BUTTONS.map((t) => (
            <button key={t.key} type="button" className="creator-type-btn" onClick={() => setOpenModal(t.key)}>
              <span className="creator-type-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-dim)', margin: '0.6rem 0 1.4rem' }}>
          Each opens a form built for that type only — no unrelated fields to skip past.
        </p>

        <Link href="/creator/series" className="account-btn-secondary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '0.7rem' }}>
          ▤ Series management
        </Link>
        <Link href="/creator/my-work" className="account-btn-secondary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          📁 View your work
        </Link>
      </main>

      {openModal && openModal !== 'series' && (
        <SubmissionModal title={TYPE_TITLES[openModal]} icon={TYPE_BUTTONS.find((t) => t.key === openModal).icon} onClose={closeModal}>
          <CreatorSubmissionForm
            allSeries={allSeries}
            initialContentType={openModal}
            lockContentType
            onSubmitted={closeModal}
          />
        </SubmissionModal>
      )}

      {episodeForSeriesId && (
        <SubmissionModal title={`Add Episode to ${seriesCreated ? seriesCreated.name : 'Series'}`} icon="📺" onClose={closeModal}>
          <CreatorSubmissionForm
            allSeries={allSeries.some((s) => s.id === episodeForSeriesId) ? allSeries : [...allSeries, { id: episodeForSeriesId, name: seriesCreated ? seriesCreated.name : 'Your new series' }]}
            initialContentType="series"
            initialSeriesId={episodeForSeriesId}
            lockContentType
            onSubmitted={closeModal}
          />
        </SubmissionModal>
      )}

      {openModal === 'series' && (
        <SubmissionModal title="Add Series" icon="📺" onClose={closeModal}>
          {seriesCreated ? (
            <div>
              <p style={{ color: 'var(--ok)', fontSize: '0.9rem' }}>
                &ldquo;{seriesCreated.name}&rdquo; was created and is pending review. You can start adding
                episodes to it right away — no need to wait.
              </p>
              <button
                type="button"
                className="account-btn-primary"
                style={{ marginTop: '0.8rem' }}
                onClick={() => { setOpenModal(null); setEpisodeForSeriesId(seriesCreated.id); }}
              >
                Add the first episode now →
              </button>
            </div>
          ) : (
            <AddSeriesForm onSubmitted={setSeriesCreated} />
          )}
        </SubmissionModal>
      )}

      <Footer />
    </>
  );
}
