import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { isTitleId } from '../../../lib/titleIds';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import ShowControlRoom from '../../../components/show/ShowControlRoom';

// The show page — one control room per series or podcast (the series
// revamp, slice 2; components/show/ShowControlRoom.js). Creators and the
// team; the show's API decides who sees what (its owner, someone with an
// episode in it read-only, the team). On a laptop the episode editor and
// Edit show open as a panel over the room with the address changed
// shallowly — ?ep=<id> (+ draft=1) or ?edit=details|art ride in this
// page's query while the bar reads /creator/show/<id>/episode/<eid> or
// /creator/show/<id>/edit, the two page files that render the same room
// on a reload. ?created=1 (New show) says the show is ready.
export async function getServerSideProps({ req, res, params }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin && !account.canAccessAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const showId = typeof params.id === 'string' ? params.id : '';
  if (!isTitleId(showId)) return { notFound: true };
  const episodes = await getPublicEpisodes();
  return {
    props: {
      showId,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function ShowPage({ showId, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const q = router.query || {};
  const ep = typeof q.ep === 'string' && isTitleId(q.ep) ? q.ep : null;
  const edit = q.edit === 'art' ? 'art' : q.edit === 'details' ? 'details' : null;
  return (
    <>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />
      <ShowControlRoom
        key={showId}
        showId={showId}
        mode="creator"
        openEpisodeId={ep}
        openIsDraft={q.draft === '1'}
        openShowEditor={edit}
        created={q.created === '1'}
      />
      <Footer />
    </>
  );
}
