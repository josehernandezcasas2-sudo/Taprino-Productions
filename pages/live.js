import { useEffect, useState } from 'react';
import Head from 'next/head';
import { getAccountContext } from '../lib/accountContext';
import { getCurrentLiveStream } from '../lib/liveStreams';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import LiveVideoPlayer from '../components/LiveVideoPlayer';
import { SITE } from '../lib/siteConfig';

import Footer from '../components/Footer';
export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [stream, episodes] = await Promise.all([getCurrentLiveStream(), getPublicEpisodes()]);
  return {
    props: {
      initialStream: stream,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function Live({ initialStream, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  const [stream, setStream] = useState(initialStream);

  // Polled rather than pushed — this is what notices a broadcast starting
  // or ending without the visitor needing to refresh the tab themselves.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch('/api/live/current')
        .then((r) => r.json())
        .then((data) => setStream(data.live ? data.stream : null))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Head>
        <title>{`${stream ? `${stream.title} — Live` : 'Live'} — ${SITE.name}`}</title>
        <meta name="description" content={stream ? stream.description || stream.title : `Live broadcasts from ${SITE.studio}.`} />
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

      <main className="stage stage-single stage-wide">
        {stream ? (
          <div className="player-card">
            <div className="now-heading">
              <div className="eyebrow">Live now</div>
              <h1>{stream.title}</h1>
              {stream.description && <p>{stream.description}</p>}
            </div>
            <LiveVideoPlayer stream={stream} isSubscriber={isSubscriber} isAdmin={isAdmin} />
            <div className="player-meta">
              <span>Live</span>
              <span>{stream.adsEnabled ? 'Ad-supported' : 'No ads on this stream'}</span>
            </div>
          </div>
        ) : (
          <div className="ca-empty" style={{ marginTop: '2rem' }}>
            <b>Nothing is live right now</b>
            Check back later, or explore the free episodes on the homepage in the meantime.
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
