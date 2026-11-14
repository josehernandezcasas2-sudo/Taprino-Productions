import Head from 'next/head';
import HeaderNav from '../../components/HeaderNav';
import MobileTabBar from '../../components/MobileTabBar';
import Footer from '../../components/Footer';
import CreatorDashboard from '../../components/creator/dashboard/CreatorDashboard';
import { getAccountContext } from '../../lib/accountContext';
import { getPublicEpisodes } from '../../lib/publicEpisodes';
import { seesDashboard } from '../../lib/creatorDashboardRules';
import { SITE } from '../../lib/siteConfig';

// The creator's Dashboard (Jose, 2026-11-14; mockup
// https://claude.ai/artifact/Sbam9nFHvuM18YhjUFgZtp, the agreement is
// mockups/creator-dashboard-contract.md): the tab bar's Dashboard tab
// lands here, and so does a creator who has just signed in. One page for
// the titles they added, where each stands, its views and what it earned,
// what needs them and the money. The body is
// components/creator/dashboard/CreatorDashboard.js.
//
// Who gets in: a creator, an admin or a sub-admin ("all creators and
// teams see the tab"). Everyone else is sent away server-side before any
// of it renders, the way /creator does. Every number on the page comes
// from a creator route with its own gate.
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isSignedIn) return { redirect: { destination: '/account', permanent: false } };
  const role = { isCreator: Boolean(account.isCreator), isAdmin: Boolean(account.isAdmin), canAccessAdmin: Boolean(account.canAccessAdmin) };
  if (!seesDashboard(role)) return { redirect: { destination: '/stream', permanent: false } };
  const episodes = await getPublicEpisodes();
  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: Boolean(account.isSubscriber),
      email: account.email ?? null,
      isAdmin: role.isAdmin,
      isCreator: role.isCreator,
      canAccessAdmin: role.canAccessAdmin
    }
  };
}

export default function CreatorDashboardPage({ mainGenres = [], isSignedIn, isSubscriber, email, isAdmin, isCreator, canAccessAdmin }) {
  return (
    <>
      <Head>
        <title>{`Dashboard — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <CreatorDashboard role={{ isCreator, isAdmin, canAccessAdmin }} />
      <Footer />
      <MobileTabBar />
    </>
  );
}
