import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getAllSeries } from '../lib/series';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';
import CreatorSubmissionForm from '../components/CreatorSubmissionForm';

// SECURITY: same enforcement pattern as /admin — a non-creator is
// redirected server-side before this page (or any creator-only data) ever
// renders.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const [allSeries, episodes] = await Promise.all([getAllSeries(), getPublicEpisodes()]);
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

// The actual form (title/description/video upload/draft-autosave/etc.)
// lives in components/CreatorSubmissionForm.js — shared with the "Add
// bonus content" popup on /creator/my-work, so there's exactly one copy
// of that upload logic rather than two that can drift apart. This page is
// just the surrounding chrome plus reading ?contentType=&seriesId= from
// the URL for old deep links into this page.
export default function CreatorSubmit({ allSeries, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();

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
        <p className="library-sub" style={{ marginBottom: '1rem' }}>Submit new episodes and track your review status.</p>
        <Link
          href="/creator/series"
          className="account-btn-secondary"
          style={{ display: 'inline-block', width: 'auto', textDecoration: 'none', marginBottom: '1.5rem' }}
        >
          ▤ Series management
        </Link>

        <CreatorSubmissionForm
          allSeries={allSeries}
          initialContentType={router.isReady ? router.query.contentType : undefined}
          initialSeriesId={router.isReady ? router.query.seriesId : undefined}
        />

        <div className="account-card" style={{ marginTop: '1.5rem' }}>
          <div className="account-eyebrow">Your work</div>
          <h3>See and manage what you've submitted</h3>
          <p style={{ margin: '0.6rem 0 1rem', fontSize: '0.87rem', color: 'var(--ink-dim)' }}>
            Pending review, already live, edit, add artwork, replace video, captions, or request deletion —
            it's all on your <Link href="/creator/my-work" style={{ color: 'var(--signal-amber)' }}>Your Work</Link> page now.
          </p>
          <Link href="/creator/my-work" className="account-btn-primary" style={{ width: 'auto', display: 'inline-block', textDecoration: 'none' }}>
            Go to Your Work →
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
