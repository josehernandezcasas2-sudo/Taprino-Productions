import { useRouter } from 'next/router';
import { getAccountContext } from '../../../../../lib/accountContext';
import { getPublicEpisodes } from '../../../../../lib/publicEpisodes';
import { isTitleId } from '../../../../../lib/titleIds';
import HeaderNav from '../../../../../components/HeaderNav';
import Footer from '../../../../../components/Footer';
import EpisodeEditor from '../../../../../components/show/EpisodeEditor';
import ShowControlRoom from '../../../../../components/show/ShowControlRoom';
import { useWide } from '../../../../../components/show/roomBits';

// The episode editor's address (series revamp slice 2; amendment 10): an
// episode of a show, an extra, or a draft (?draft=1, or found by its id
// when the episode read says there is none). On a laptop (from 1024px) it
// is the show page with the editor open as its right-hand panel — the room
// pushes this address shallowly when a row is opened, so a reload or a
// shared link lands on the same thing; on a phone it is the editor as a
// screen (phone first, the site header's Connect side, no tab bar).
// Creators and the team only, like every creator tool page; the editor's
// API decides who may see and change which episode.
export async function getServerSideProps({ req, res, params, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  if (!account.isCreator && !account.isAdmin && !account.canAccessAdmin) {
    return { redirect: { destination: '/stream', permanent: false } };
  }
  const showId = typeof params.id === 'string' ? params.id : '';
  const episodeId = typeof params.episodeId === 'string' ? params.episodeId : '';
  if (!isTitleId(showId) || !isTitleId(episodeId)) return { notFound: true };
  const episodes = await getPublicEpisodes();
  return {
    props: {
      showId,
      episodeId,
      isDraft: query.draft === '1',
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function EditEpisodePage({ showId, episodeId, isDraft, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const router = useRouter();
  const wide = useWide();
  // The room opens another row on this same address shallowly.
  const ep = typeof router.query.episodeId === 'string' && isTitleId(router.query.episodeId) ? router.query.episodeId : episodeId;
  const draft = router.query.draft === '1' || (ep === episodeId && isDraft);
  return (
    <>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />
      {wide === null ? (
        <main id="main-content" className="show-room-stage"><div className="show-room is-waiting" aria-busy="true"><div className="show-room-skeleton"><span /><span /><span /></div></div></main>
      ) : wide ? (
        <ShowControlRoom key={showId} showId={showId} mode="creator" openEpisodeId={ep} openIsDraft={draft} />
      ) : (
        <main id="main-content" className="show-ed-stage">
          <EpisodeEditor
            key={ep}
            showId={showId}
            episodeId={ep}
            isDraft={draft}
            mode="creator"
            layout="page"
            onClose={() => router.push(`/creator/show/${encodeURIComponent(showId)}`)}
          />
        </main>
      )}
      <Footer />
    </>
  );
}
