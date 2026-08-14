import Head from 'next/head';
import Link from 'next/link';
import HeaderNav from './HeaderNav';
import MobileTabBar from './MobileTabBar';
import { SITE } from '../lib/siteConfig';

// Shared shell for /terms, /privacy and /cookies so the three stay visually
// consistent and only the prose differs.
export default function LegalLayout({ title, updated, summary, children, account = {} }) {
  return (
    <>
      <Head>
        <title>{title} — {SITE.name}</title>
        <meta name="description" content={`${title} for ${SITE.name}, a ${SITE.studio} project.`} />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={account.mainGenres || []}
        isSignedIn={account.isSignedIn}
        email={account.email}
        isAdmin={account.isAdmin}
        isCreator={account.isCreator}
        isSubscriber={account.isSubscriber}
      />

      <main className="stage stage-single legal-page">
        <Link href="/" className="library-back" style={{ display: 'inline-block', marginBottom: '1.2rem' }}>
          ← Back to screening room
        </Link>

        <div className="eyebrow">Legal</div>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        {summary && <div className="legal-summary">{summary}</div>}

        <div className="legal-body">{children}</div>

        <nav className="legal-crosslinks" aria-label="Other policies">
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/cookies">Cookies</Link>
        </nav>
      </main>

      <footer className="site-footer">
        <span>{SITE.nameUpper}</span>
        <span>© {new Date().getFullYear()} {SITE.studio}</span>
      </footer>
      <MobileTabBar />
    </>
  );
}
