import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';

// TEMPLATE — NOT LEGAL ADVICE.
// Written to match what this codebase actually does, so it is accurate rather
// than generic. It has not been reviewed by a lawyer. Before running real ads
// or taking payments from the public, have someone qualified read it — the
// GDPR/CCPA sections in particular depend on where your viewers are and are
// the parts most likely to need real changes.
//
// Placeholders to fill in before publishing: [CONTACT EMAIL], [MAILING
// ADDRESS], [JURISDICTION].

export async function getServerSideProps({ req }) {
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
          <strong>The short version.</strong> You can watch most of Taprino Transmission without an
          account. If you make one, we store your email and what you&rsquo;ve watched so the site can
          remember where you left off. We show ads on free content, and those ads come from Google.
          We don&rsquo;t sell your personal information. You can ask us to delete your account and
          everything attached to it at any time by emailing [CONTACT EMAIL].
        </>
      }
    >
      <h2>Who we are</h2>
      <p>
        Taprino Transmission is a streaming service operated by Studio Taprino ([MAILING ADDRESS]).
        For anything in this policy, reach us at [CONTACT EMAIL].
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

      <h3>If you subscribe to Cipher Circle</h3>
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

      <h2>Advertising</h2>
      <p>
        Free content is supported by ads served through Google. Google may use cookies and similar
        technologies to select ads, and in some configurations to personalise them based on your
        activity across other sites. This is Google&rsquo;s processing, not ours — we receive
        aggregate performance data, not profiles of individual viewers. You can review and change
        what Google uses at{' '}
        <a href="https://myadcenter.google.com" target="_blank" rel="noopener noreferrer">
          myadcenter.google.com
        </a>
        . Cipher Circle members are not shown ads and no ad request is made on their behalf.
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
        Wherever you live, you can email [CONTACT EMAIL] and ask us to show you what we hold about
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
        Taprino Transmission isn&rsquo;t directed at children under 13, and we don&rsquo;t knowingly
        collect their personal information. If you believe a child has given us information, email
        [CONTACT EMAIL] and we&rsquo;ll delete it.
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
