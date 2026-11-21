import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { getAccountContext } from '../../../lib/accountContext';
import { getPublicEpisodes } from '../../../lib/publicEpisodes';
import { isTitleId } from '../../../lib/titleIds';
import Link from 'next/link';
import HeaderNav from '../../../components/HeaderNav';
import Footer from '../../../components/Footer';
import ShowControlRoom from '../../../components/show/ShowControlRoom';
import ShowOverview from '../../../components/show/ShowOverview';
import { BackArrowIcon } from '../../../components/PlayerIcons';
import ScreeningsTab, { screeningsBadge, useScreeningsList } from '../../../components/creator/screenings/ScreeningsTab';
import { SHOW_TABS } from '../../../lib/titleDashRules';

// The show page — one control room per series or podcast (the series
// revamp, slice 2; components/show/ShowControlRoom.js). Creators and the
// team; the show's API decides who sees what (its owner, someone with an
// episode in it read-only, the team). On a laptop the episode editor and
// Edit show open as a panel over the room with the address changed
// shallowly — ?ep=<id> (+ draft=1) or ?edit=details|art ride in this
// page's query while the bar reads /creator/show/<id>/episode/<eid> or
// /creator/show/<id>/edit, the two page files that render the same room
// on a reload. ?created=1 (New show) says the show is ready.
//
// Overview · Episodes (2026-11-15; mockups/work-revamp-contract.md): a row
// of two tabs under the back pill. The page opens on Episodes — the room,
// with every link above working as before — and ?tab=overview draws the
// show's numbers, money and what needs the creator
// (components/show/ShowOverview.js) in its place. The two page files under
// /creator/show/<id>/ (episode/[episodeId], edit) have no tabs.
//
// Private screenings (migration 128, 2026-11-21): the third tab,
// ?tab=screenings, is components/creator/screenings/ScreeningsTab.js with
// the show as its target (a link plays the whole show, a season or the
// episodes picked). The page reads the show's links so the tab can say
// "3 live"; for someone who doesn't run the show the route answers that
// only whoever runs it makes its links.
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
  const tab = q.tab === 'overview' ? 'overview' : q.tab === 'screenings' ? 'screenings' : 'episodes';
  const base = `/creator/show/${encodeURIComponent(showId)}`;
  const screeningTarget = useMemo(() => ({ type: 'series', id: showId }), [showId]);
  const screenings = useScreeningsList(screeningTarget);
  const screeningsLive = screeningsBadge(screenings);
  // Vertical shows get no private screening links (the app hides the tab too).
  const vertical = screenings.state === 'ok' && screenings.data && screenings.data.target && screenings.data.target.contentType === 'vertical';
  const tabs = vertical ? SHOW_TABS.filter((t) => t.key !== 'screenings') : SHOW_TABS;
  return (
    <>
      <HeaderNav mainGenres={mainGenres} isSignedIn={isSignedIn} isSubscriber={isSubscriber} email={email} isAdmin={isAdmin} isCreator={isCreator} />
      <div className="td-show-top">
        <Link href="/creator/dashboard" className="acct-back td-back"><BackArrowIcon size={14} /> Dashboard</Link>
        <nav className="td-tabs td-show-tabs" aria-label="This show">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key === 'episodes' ? base : `${base}?tab=${encodeURIComponent(t.key)}`}
              shallow
              scroll={false}
              className={`td-tab${t.key === tab ? ' on' : ''}`}
              aria-current={t.key === tab ? 'page' : undefined}
            >
              {t.label}
              {t.key === 'screenings' && screeningsLive ? <span className="scn-tab-badge">{screeningsLive}</span> : null}
            </Link>
          ))}
        </nav>
      </div>
      {tab === 'overview' ? (
        <ShowOverview key={showId} showId={showId} />
      ) : tab === 'screenings' && !vertical ? (
        <main id="main-content" className="td-page td-show">
          <ScreeningsTab key={showId} target={screeningTarget} route={screenings} withHead />
        </main>
      ) : (
        <div className="td-show-room">
          <ShowControlRoom
            key={showId}
            showId={showId}
            mode="creator"
            openEpisodeId={ep}
            openIsDraft={q.draft === '1'}
            openShowEditor={edit}
            created={q.created === '1'}
          />
        </div>
      )}
      <Footer />
    </>
  );
}
