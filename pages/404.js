import Head from 'next/head';
import Link from 'next/link';
import ErrorPageNav from '../components/ErrorPageNav';
import { SITE } from '../lib/siteConfig';

// Next's default 404 is an unstyled white page with a system font — jarring
// on a dark site, and it gives someone no way back other than the browser
// button. No data fetching on the server (the page is static), nothing
// that could itself fail and turn a 404 into a 500; the header comes from
// ErrorPageNav, which asks who is signed in from the browser and falls
// back to the signed-out header if that can't be answered.
export default function NotFound() {
  return (
    <>
      <Head>
        <title>Not found — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <ErrorPageNav />
      <main className="error-page">
        <div className="error-code">404</div>
        <h1>This page doesn&rsquo;t exist</h1>
        <p>
          The link may be old, or the episode might have been taken down. Either way, there&rsquo;s
          plenty else to watch.
        </p>
        <div className="error-actions">
          <Link href="/stream" className="account-btn-primary">Back to the screening room</Link>
          <Link href="/live" className="account-btn-secondary">See what&rsquo;s on the channel</Link>
        </div>
      </main>
    </>
  );
}
