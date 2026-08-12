import Head from 'next/head';
import { getAccountContext } from '../lib/accountContext';
import { getChannelState } from '../lib/channelSchedule';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import ChannelPlayer from '../components/ChannelPlayer';

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const [channelState, episodes] = await Promise.all([getChannelState(), getPublicEpisodes()]);
  return {
    props: {
      channelState,
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function Channel({ channelState, mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  return (
    <>
      <Head>
        <title>The Channel — Taprino Transmission</title>
        <meta
          name="description"
          content="Studio Taprino's linear channel — free episodes, playing continuously, tune in any time."
        />
      </Head>

      <HeaderNav
        activeType="All"
        onTypeSelect={() => {}}
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />
      <div className="install-row"><InstallButton /></div>

      <main className="stage stage-single">
        <div className="now-heading">
          <div className="eyebrow">The channel</div>
          <h1>{channelState.onAir ? channelState.program.title : 'Taprino Transmission'}</h1>
          {channelState.onAir && channelState.program.description && <p>{channelState.program.description}</p>}
        </div>

        <div className="player-card">
          <ChannelPlayer initialState={channelState} />
          {channelState.onAir && (
            <div className="player-meta">
              <span>Playing now</span>
              <span>Up next: {channelState.next.title}</span>
            </div>
          )}
        </div>

        <p className="ca-foot" style={{ marginTop: '1.2rem' }}>
          The channel plays free episodes back to back, on a loop — like a TV channel, not on-demand.
          There&rsquo;s no rewinding or picking what&rsquo;s on; if you want to choose, the homepage is
          where to do that.
        </p>
      </main>

      <footer className="site-footer">
        <span>TAPRINO TRANSMISSION</span>
        <span>© {new Date().getFullYear()} Studio Taprino</span>
        <span className="footer-legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/cookies">Cookies</a>
        </span>
      </footer>
      <MobileTabBar />
    </>
  );
}
