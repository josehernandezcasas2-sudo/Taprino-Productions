import Head from 'next/head';
import Link from 'next/link';
import HeaderNav from '../HeaderNav';
import MobileTabBar from '../MobileTabBar';
import Footer from '../Footer';
import { BackArrowIcon } from '../PlayerIcons';
import { SITE } from '../../lib/siteConfig';

// The frame every page of the account hub shares (option B, 2026-10-29):
// the site header, the stage, a Back pill to the hub, the page title,
// the content, the footer and the tab bar. The hub itself renders
// without the pill (it has the standard Back button to Stream).
export default function AccountShell({ title, back = true, lede = null, aside = null, mainGenres = [], isSignedIn, isSubscriber, email, isAdmin, isCreator, children }) {
  return (
    <>
      <Head>
        <title>{`${title ? `${title} — ` : ''}Account — ${SITE.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <HeaderNav
        isSignedIn={isSignedIn}
        isSubscriber={isSubscriber}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        mainGenres={mainGenres}
      />
      <main id="main-content" className="stage stage-single acct-stage">
        {back && (
          <Link href="/account" className="acct-back">
            <BackArrowIcon size={14} /> Account
          </Link>
        )}
        {title && (
          <div className="acct-title-row">
            <h1 className="acct-title">{title}</h1>
            {aside}
          </div>
        )}
        {lede && <p className="acct-lede">{lede}</p>}
        <div className="acct-body">{children}</div>
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
