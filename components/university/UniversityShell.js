import Head from 'next/head';
import HeaderNav from '../HeaderNav';
import MobileTabBar from '../MobileTabBar';
import Footer from '../Footer';
import { SITE } from '../../lib/siteConfig';

// The page frame every /university page shares: header (Connect side),
// the .uni-page main column, footer, phone tab bar. Props come straight
// from lib/universityPage.js.
export default function UniversityShell({ title, description, account, mainGenres, wide = false, children }) {
  return (
    <>
      <Head>
        <title>{title ? `${title} — Film University — ${SITE.name}` : `Film University — ${SITE.name}`}</title>
        <meta name="description" content={description || `Free film lessons, exercises and templates from ${SITE.studio}.`} />
      </Head>
      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={account.isSignedIn}
        email={account.email}
        isAdmin={account.isAdmin}
        isCreator={account.isCreator}
        isSubscriber={account.isSubscriber}
      />
      <main id="main-content" className={`stage stage-single uni-page${wide ? ' uni-page-wide' : ''}`}>
        {children}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

export function accountFromProps(props) {
  return {
    isSignedIn: props.isSignedIn,
    isSubscriber: props.isSubscriber,
    email: props.email,
    isAdmin: props.isAdmin,
    isCreator: props.isCreator
  };
}
