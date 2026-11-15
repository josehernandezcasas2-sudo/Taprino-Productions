import { getAccountContext } from '../../../lib/accountContext';
import { getAllSeries } from '../../../lib/series';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { isTitleId } from '../../../lib/titleIds';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import MobileTabBar from '../../../components/MobileTabBar';
import TitleDashboard from '../../../components/creator/title/TitleDashboard';

// A title's dashboard (2026-11-15; mockups/work-revamp-contract.md, the
// canvas's "Dashboard · a film"): a film, a short, an extra or a vertical
// title of its own opens here from Your work and the Dashboard. The body
// is components/creator/title/TitleDashboard.js, which reads the creator
// routes on the client like the Dashboard does. Who gets in is what Your
// work lets in (a creator or an admin); every number comes from a route
// with its own gate, and a title that isn't theirs reads as not found.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const id = typeof params.id === 'string' ? params.id : '';
  if (!isTitleId(id)) return { notFound: true };
  // The admin's "Edit full details" box lists the shows; nobody else needs them.
  const [allSeries, episodes] = await Promise.all([account.isAdmin ? getAllSeries(account.userId) : Promise.resolve([]), getPublicEpisodes()]);
  return {
    props: {
      id,
      isSignedIn: Boolean(account.isSignedIn),
      isSubscriber: Boolean(account.isSubscriber),
      email: account.email ?? null,
      isAdmin: Boolean(account.isAdmin),
      isCreator: Boolean(account.isCreator),
      canAccessAdmin: Boolean(account.canAccessAdmin),
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      allSeries: allSeries || []
    }
  };
}

export default function TitleDashboardPage({ id, isSignedIn, isSubscriber, email, isAdmin, isCreator, canAccessAdmin, mainGenres, allSeries }) {
  return (
    <>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <TitleDashboard key={id} id={id} isAdmin={isAdmin} isCreator={isCreator} canAccessAdmin={canAccessAdmin} allSeries={allSeries} />
      <Footer />
      <MobileTabBar />
    </>
  );
}
