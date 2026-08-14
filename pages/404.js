import Head from 'next/head';
import Link from 'next/link';
import { SITE } from '../lib/siteConfig';

// Next's default 404 is an unstyled white page with a system font — jarring
// on a dark site, and it gives someone no way back other than the browser
// button. Deliberately dependency-free: no HeaderNav, no data fetching,
// nothing that could itself fail and turn a 404 into a 500.
export default function NotFound() {
  return (
    <>
      <Head>
        <title>Not found — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="error-page">
        <div className="error-code">404</div>
        <h1>This page doesn&rsquo;t exist</h1>
        <p>
          The link may be old, or the episode might have been taken down. Either way, there&rsquo;s
          plenty else to watch.
        </p>
        <div className="error-actions">
          <Link href="/" className="account-btn-primary">Back to the screening room</Link>
          <Link href="/channel" className="account-btn-secondary">See what&rsquo;s on the channel</Link>
        </div>
      </main>
    </>
  );
}
