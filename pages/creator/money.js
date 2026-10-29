import Head from 'next/head';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import MoneyPage from '../../components/creator/MoneyPage';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { getOwnListings } from '../../lib/locations';
import { SITE } from '../../lib/siteConfig';

// The creator's Money page (mockup signed off 2026-10-23): every lane
// that pays them in one place — member support (Creator Share), title
// sales, backing, bookings — with what is owed, what Stripe already
// holds, a History of every line, and the CSV. The body is
// components/creator/MoneyPage.js (reads /api/creator/money,
// lib/creatorMoney.js); nothing here moves money. The app's
// creator/money screen is the same page stacked.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return { redirect: { destination: '/account', permanent: false } };
  if (!account.isCreator && !account.isAdmin) {
    // A host who isn't a creator has a Bookings lane of their own.
    const listings = await getOwnListings(account.userId).catch(() => []);
    if (!listings.length) return { redirect: { destination: '/account', permanent: false } };
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

export default function CreatorMoney({ mainGenres = [], isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  return (
    <>
      <Head>
        <title>{`Money — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <MoneyPage />
      <Footer />
      <MobileTabBar />
    </>
  );
}
