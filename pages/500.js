import Head from 'next/head';
import Link from 'next/link';
import { SITE } from '../lib/siteConfig';

// Shown when something genuinely broke server-side. Kept as simple as the
// 404 — if the app is already failing, this page must not depend on
// anything that could fail alongside it.
export default function ServerError() {
  return (
    <>
      <Head>
        <title>Something went wrong — {SITE.name}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="error-page">
        <div className="error-code">500</div>
        <h1>Something broke on our end</h1>
        <p>
          Not your fault. Try again in a moment — if it keeps happening, we&rsquo;d genuinely like
          to know.
        </p>
        <div className="error-actions">
          <Link href="/" className="account-btn-primary">Back to the screening room</Link>
        </div>
      </main>
    </>
  );
}
