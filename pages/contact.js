import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE } from '../lib/siteConfig';

// Also an AdSense requirement — reviewers want a working way to reach the
// site owner. A plain email address satisfies this and is more honest than
// a contact form that quietly drops messages, which is a real failure mode
// when nobody's watching the inbox behind it.
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

export default function Contact({ account }) {
  return (
    <LegalLayout
      title="Contact"
      updated="August 13, 2026"
      account={account}
      summary={
        <>
          Email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> — it reaches a real
          person. Below is a rough guide to what goes where, so your message lands with whoever can
          actually help.
        </>
      }
    >
      <h2>Submitting work</h2>
      <p>
        Use the <a href="/apply">application form</a> rather than email — it asks for the things
        we need to make a decision, which means a faster answer than a cold email would get.
      </p>

      <h2>Membership and billing</h2>
      <p>
        Questions about Cipher Circle, refunds, or a charge you don&rsquo;t recognise:{' '}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. Include the email address
        on the account so we can find it.
      </p>

      <h2>Something&rsquo;s broken</h2>
      <p>
        Video won&rsquo;t play, captions are wrong, a page is misbehaving — tell us what you were
        doing, what device and browser you&rsquo;re on, and what happened. Specifics genuinely
        speed this up.
      </p>

      <h2>Accessibility</h2>
      <p>
        If any part of {SITE.name} is difficult or impossible for you to use, we want to hear about
        it, and we treat these as higher priority than feature requests.
      </p>

      <h2>Privacy and your data</h2>
      <p>
        To see, correct, export, or delete the data we hold about you, email us with the subject
        line &ldquo;Data request.&rdquo; We respond within 30 days, as described in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Copyright</h2>
      <p>
        To report infringing material, follow the notice procedure in section 7 of our{' '}
        <a href="/terms">Terms of Service</a> so we can act on it properly.
      </p>

      <h2>Postal</h2>
      <p>{SITE.studio}<br />{SITE.mailingAddress}</p>
    </LegalLayout>
  );
}
