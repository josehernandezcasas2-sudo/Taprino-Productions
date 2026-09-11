import Head from 'next/head';
import BackButton from '../../../components/BackButton';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import AddPitchForm from '../../../components/AddPitchForm';
import { SITE } from '../../../lib/siteConfig';

export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
  // Same gate as the video-episode submission page — pitch submission
  // requires the creator role, not just any signed-in account.
  if (!account.isCreator) {
    return { redirect: { destination: '/', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres
    }
  };
}

// The form itself lives in components/AddPitchForm.js, shared with the
// popup version opened from Creator Studio (pages/creator.js) — this
// page is now just that shared form's original standalone home, still
// linked to directly from pages/pitches.js.
export default function NewPitch({ isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres }) {
  const router = useRouter();

  return (
    <>
      <Head>
        <title>Submit a project — Pitch Room — {SITE.name}</title>
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single">
        <BackButton fallbackHref="/pitches" />
        <h1>Submit a project</h1>

        <div className="account-card" style={{ maxWidth: 640 }}>
          <AddPitchForm onSubmitted={() => router.push('/creator/pitch/dashboard')} />
        </div>
      </main>
      <Footer />
    </>
  );
}

