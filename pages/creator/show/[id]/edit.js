import { useRouter } from 'next/router';
import { getAccountContext } from '../../../../lib/accountContext';
import { getPublicEpisodes } from '../../../../lib/publicEpisodes';
import { isTitleId } from '../../../../lib/titleIds';
import HeaderNav from '../../../../components/HeaderNav';
import Footer from '../../../../components/Footer';
import ShowEditor from '../../../../components/show/ShowEditor';
import ShowControlRoom from '../../../../components/show/ShowControlRoom';
import { useWide } from '../../../../components/show/roomBits';

// Edit show's address (series revamp slice 2, amendment 13): Details and
// Art (?tab=art opens the second). On a laptop it is the show page with
// Edit show open as its right-hand panel (the room pushes this address
// shallowly); on a phone, the editor as a screen inside the site header
// like the creator tool pages. Creators and the team only; the show's API
// decides who may change it (its owner or the team).
export async function getServerSideProps({ req, res, params, query }) {
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
      tab: query.tab === 'art' ? 'art' : 'details',
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function EditShowPage({ showId, tab, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const wide = useWide();
  return (
    <>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />
      {wide === null ? (
        <main id="main-content" className="show-room-stage"><div className="show-room is-waiting" aria-busy="true"><div className="show-room-skeleton"><span /><span /><span /></div></div></main>
      ) : wide ? (
        <ShowControlRoom key={showId} showId={showId} mode="creator" openShowEditor={tab} />
      ) : (
        <main id="main-content" className="show-ed-stage">
          <ShowEditor
            showId={showId}
            mode="creator"
            layout="page"
            tab={tab}
            onClose={() => router.push(`/creator/show/${encodeURIComponent(showId)}`)}
          />
        </main>
      )}
      <Footer />
    </>
  );
}
