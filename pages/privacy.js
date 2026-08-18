import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE } from '../lib/siteConfig';

// TEMPLATE — NOT LEGAL ADVICE.
// Written to match what this codebase actually does, so it is accurate rather
// than generic. It has not been reviewed by a lawyer. Before running real ads
// or taking payments from the public, have someone qualified read it — the
// GDPR/CCPA sections in particular depend on where your viewers are and are
// the parts most likely to need real changes.
//
// Placeholders to fill in before publishing: {SITE.contactEmail}, [MAILING
// ADDRESS], {SITE.jurisdiction}.

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

export default function Privacy({ account }) {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="August 11, 2026"
      account={account}
      summary={
        <>
          <strong>The short version.</strong> You can watch most of {SITE.name} without an
          account. If you make one, we store your email and what you&rsquo;ve watched so the site can
          remember where you left off. We show ads on free content, and those ads come from Google.
          We don&rsquo;t sell your personal information. You can ask us to delete your account and
          everything attached to it at any time by emailing {SITE.contactEmail}.
        </>
      }
    >
      <h2>Who we are</h2>
      <p>
        {SITE.name} is a streaming service operated by {SITE.studio} ({SITE.mailingAddress}).
        For anything in this policy, reach us at {SITE.contactEmail}.
      </p>

      <h2>What we collect</h2>

      <h3>If you just watch</h3>
      <p>
        You don&rsquo;t need an account to watch free content. When you open an episode page we
        increment a counter for that episode. That counter is not tied to you — it records that an
        episode was opened, not who opened it. Our hosting provider also keeps standard server logs
        (IP address, browser type, pages requested) for security and troubleshooting.
      </p>

      <h3>If you make an account</h3>
      <ul>
        <li><strong>Email address and password</strong> — handled by our authentication provider, Clerk. We never see or store your password.</li>
        <li><strong>Watch progress</strong> — which episodes you&rsquo;ve started and how far in, so you can resume.</li>
        <li><strong>Your wishlist</strong> — episodes and series you&rsquo;ve saved.</li>
        <li><strong>Email preferences</strong> — whether you want to hear about new drops.</li>
      </ul>

      <h3>If you subscribe to {SITE.premiumTier}</h3>
      <p>
        Payments are processed by Stripe. <strong>We never receive or store your card number.</strong>{' '}
        We keep a Stripe customer reference and your subscription status so we know what you have
        access to. Stripe&rsquo;s own privacy policy governs the payment data they hold.
      </p>

      <h3>If you submit work as a creator</h3>
      <p>
        We store your video files, artwork, titles, descriptions, and the account that submitted
        them. Video is hosted with Cloudflare Stream. Administrative actions taken on your
        submissions are recorded in an internal audit log.
      </p>

      <h2>Advertising and Google AdSense</h2>
      <p>
        Free content on {SITE.name} is supported by advertising. We use{' '}
        <strong>Google AdSense</strong> to serve display advertising, and the Google IMA SDK to
        serve video advertising in the player.
      </p>
      <ul>
        <li>
          <strong>Google, as a third-party vendor, uses cookies to serve ads on this site.</strong>{' '}
          Google&rsquo;s use of advertising cookies enables it and its partners to serve ads to you
          based on your visit to this site and/or other sites on the internet.
        </li>
        <li>
          You may opt out of personalised advertising by visiting{' '}
          <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
            Google Ads Settings
          </a>{' '}
          or{' '}
          <a href="https://myadcenter.google.com" target="_blank" rel="noopener noreferrer">
            My Ad Center
          </a>
          .
        </li>
        <li>
          You can opt out of third-party vendors&rsquo; use of cookies for personalised advertising
          at{' '}
          <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
            aboutads.info/choices
          </a>
          .
        </li>
        <li>
          Third-party vendors and ad networks may also serve ads here and use their own cookies to
          measure ad performance.
        </li>
      </ul>
      <p>
        This is Google&rsquo;s processing, not ours — we receive aggregate performance figures, not
        profiles of individual viewers. <strong>{SITE.premiumTier} members are shown no ads</strong>, and
        no ad request is made on their behalf, so no advertising cookies are set for them.
      </p>
      <p>
        If you are in the EEA or UK, Google serves ads in accordance with its obligations under the
        GDPR, and where required we will ask for your consent before personalised advertising
        cookies are set.
      </p>

      <h2>Who we share data with</h2>
      <p>We use these services, and only for the purposes listed:</p>
      <ul>
        <li><strong>Clerk</strong> — accounts and sign-in</li>
        <li><strong>Stripe</strong> — payments and subscriptions</li>
        <li><strong>Supabase</strong> — our content and account database</li>
        <li><strong>Cloudflare Stream</strong> — video hosting and delivery</li>
        <li><strong>Vercel</strong> — website hosting</li>
        <li><strong>Upstash</strong> — view counters</li>
        <li><strong>Google</strong> — advertising on free content</li>
        <li><strong>Resend</strong> — email notifications, if you opt in</li>
      </ul>
      <p>
        <strong>We do not sell your personal information</strong>, and we don&rsquo;t share it with
        anyone for their own marketing.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account data is kept while your account exists. Ask us to delete it and we remove your
        account, watch history, and wishlist within 30 days — except records we&rsquo;re required to
        keep, such as payment records for tax purposes. Anonymous view counters and daily totals
        expire on their own after roughly 400 days. Submitted work is kept while it&rsquo;s published;
        creators can request removal.
      </p>

      <h2>Your rights</h2>
      <p>
        Wherever you live, you can email {SITE.contactEmail} and ask us to show you what we hold about
        you, correct it, delete it, or send you a copy. We&rsquo;ll respond within 30 days.
      </p>
      <p>
        If you&rsquo;re in the UK or EEA, the UK GDPR and GDPR give you these rights formally, plus the
        right to object to processing and to complain to your data protection authority. Our legal
        bases are: <em>contract</em> for running your account and subscription, <em>legitimate
        interests</em> for security and basic analytics, and <em>consent</em> for marketing email and
        personalised advertising.
      </p>
      <p>
        If you&rsquo;re in California, the CCPA/CPRA gives you the right to know, delete, correct, and
        opt out of &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of personal information, and not to be
        discriminated against for exercising them. We don&rsquo;t sell personal information. Ad
        personalisation may count as &ldquo;sharing&rdquo; under California law — email us to opt out.
      </p>

      <h2>Children</h2>
      <p>
        {SITE.name} isn&rsquo;t directed at children under 13, and we don&rsquo;t knowingly
        collect their personal information. If you believe a child has given us information, email
        {SITE.contactEmail} and we&rsquo;ll delete it.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted in transit. Passwords are handled entirely by Clerk. Premium video is
        served through expiring signed links rather than permanent public URLs. No system is perfectly
        secure, but if a breach affects your data we&rsquo;ll tell you and any regulator we&rsquo;re
        required to notify.
      </p>

      <h2>Changes</h2>
      <p>
        We&rsquo;ll update the date at the top when this changes. If a change materially affects your
        rights, we&rsquo;ll tell account holders by email.
      </p>
    </LegalLayout>
  );
}
