import Head from 'next/head';
import HeaderNav from '../HeaderNav';
import MobileTabBar from '../MobileTabBar';
import Footer from '../Footer';
import { SITE } from '../../lib/siteConfig';

// Page frame for /productions/*: same shell the Crew Call pages use.
export default function ProductionShell({ title, description, children, mainGenres, isSignedIn, email, isAdmin, isCreator, isSubscriber }) {
  return (
    <>
      <Head>
        <title>{title} — Productions — {SITE.name}</title>
        <meta name="description" content={description || 'Productions on Studio Tapa: who’s making what, who’s on it, what’s open.'} />
      </Head>
      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />
      <main id="main-content" className="stage stage-single crew-page prod-page">{children}</main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

// The props every /productions page builds from the account context.
export function shellProps(account, episodes) {
  return {
    mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
    isSignedIn: account.isSignedIn,
    isSubscriber: account.isSubscriber,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator,
    viewerId: account.userId || null
  };
}
