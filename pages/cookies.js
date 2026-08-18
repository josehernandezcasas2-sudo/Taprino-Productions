import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE } from '../lib/siteConfig';

// TEMPLATE — NOT LEGAL ADVICE.
// Accurate to what this codebase actually sets today. If you add analytics
// (Plausible, GA) or a consent banner later, update the table below to match —
// a cookie policy that lists the wrong cookies is worse than none, because it
// looks like you checked.
//
// Contact details, address, and jurisdiction all come from
// lib/siteConfig.js — fill them in there once, not here.

export async function getServerSideProps({ req, res }) {
  // WO-2 asked whether these could become getStaticProps. They can't as
  // written: each one fetches account context so the header nav renders
  // correctly for signed-in users (their name, admin link, tier). Dropping
  // that would break the header on every legal page.
  //
  // Caching gets the same saving without that regression. Legal text
  // changes maybe a few times a year, so signed-out visitors — which
  // includes every crawler, and the AdSense reviewer — can hold a copy for
  // an hour and revalidate in the background for a day after that.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Cookie');
  }

  const account = await getAccountContext(req);
  const episodes = await getPublicEpisodes();
  return {
    props: {
      account: {
        mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
        isSignedIn: account.isSignedIn,
        isSubscriber: account.isSubscriber,
        email: account.email,
        isAdmin: account.isAdmin,
        isCreator: account.isCreator
      }
    }
  };
}

export default function Cookies({ account }) {
  return (
    <LegalLayout
      title="Cookies"
      updated="August 11, 2026"
      account={account}
      summary={
        <>
          <strong>The short version.</strong> We use cookies to keep you signed in, remember your
          settings, and take payments. On free content, Google also sets cookies to serve ads. We
          don&rsquo;t run any third-party analytics or tracking pixels.
        </>
      }
    >
      <h2>What we set ourselves</h2>
      <table className="legal-table">
        <thead>
          <tr><th>Purpose</th><th>Set by</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Sign-in session</td>
            <td>Clerk</td>
            <td>Keeps you logged in between visits. Without it you&rsquo;d sign in on every page.</td>
          </tr>
          <tr>
            <td>Payment session</td>
            <td>Stripe</td>
            <td>Runs checkout and detects fraud during payment.</td>
          </tr>
          <tr>
            <td>Local preferences</td>
            <td>This site</td>
            <td>
              Stored in your browser, not sent to us: your saved wishlist while signed out, unsent
              draft submissions, and whether you&rsquo;ve dismissed the install prompt.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        These are strictly necessary for the site to work as you&rsquo;d expect. Blocking them will
        break sign-in and payment.
      </p>

      <h2>Advertising cookies</h2>
      <p>
        Free content carries ads served by Google. Google may set cookies to decide which ads to
        show, limit how often you see the same one, and measure whether it was watched. We don&rsquo;t
        control these and we don&rsquo;t receive the data behind them — only aggregate performance
        figures.
      </p>
      <p>
        You can control this at{' '}
        <a href="https://myadcenter.google.com" target="_blank" rel="noopener noreferrer">
          myadcenter.google.com
        </a>
        , or opt out of personalised advertising across many companies at{' '}
        <a href="https://optout.aboutads.info" target="_blank" rel="noopener noreferrer">
          optout.aboutads.info
        </a>
        .
      </p>
      <p>
        <strong>{SITE.premiumTier} members see no ads</strong>, and no ad request is made for them, so no
        advertising cookies are set on their behalf.
      </p>

      <h2>What we don&rsquo;t use</h2>
      <p>
        No Google Analytics. No Facebook pixel. No cross-site tracking or data brokers. Our view
        counters record that an episode was opened, not who opened it.
      </p>

      <h2>Managing cookies</h2>
      <p>
        Every major browser lets you block or delete cookies in its settings. Blocking everything will
        stop you signing in or subscribing here, and will break plenty of other sites too.
      </p>

      <h2>Questions</h2>
      <p>{SITE.contactEmail}</p>
    </LegalLayout>
  );
}
