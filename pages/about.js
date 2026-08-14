import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import LegalLayout from '../components/LegalLayout';
import { SITE } from '../lib/siteConfig';

// AdSense reviewers specifically look for an About page as a legitimacy
// signal — "is a real organisation behind this, or is it a content farm."
// A two-line placeholder reads worse than none, so this says something
// real about what the platform is and who runs it.
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

export default function About({ account }) {
  return (
    <LegalLayout
      title="About"
      updated="August 13, 2026"
      account={account}
      summary={
        <>
          <strong>{SITE.name}</strong> is a streaming platform run by {SITE.studio} for independent
          film and series work. Most of what&rsquo;s here is free to watch, supported by ads.
          Cipher Circle is an optional membership that removes them.
        </>
      }
    >
      <h2>What this is</h2>
      <p>
        {SITE.name} exists because independent work has a distribution problem. Finishing a short
        film or a series is hard enough; getting it in front of people who&rsquo;d actually want to
        watch it is somehow harder. Most platforms either bury independent work under an algorithm
        tuned for something else, or ask creators to build an audience from nothing before
        they&rsquo;ll pay attention.
      </p>
      <p>
        We take a smaller, more deliberate approach: work is reviewed and programmed rather than
        uploaded and forgotten. Every title here was watched by a person before it went live.
      </p>

      <h2>How it works for viewers</h2>
      <p>
        Most of the catalogue is free and supported by advertising — no account needed to watch.
        Making a free account adds a watchlist and remembers where you left off across devices.
      </p>
      <p>
        <strong>Cipher Circle</strong> is a paid membership that removes ads, unlocks
        behind-the-scenes material, and gives early access to some releases. It funds the platform
        and the work on it.
      </p>

      <h2>How it works for creators</h2>
      <p>
        We don&rsquo;t run open uploads. Creators apply through our{' '}
        <a href="/apply">submission form</a>, and if the work is a fit, we handle the encoding,
        captioning, artwork, and publishing ourselves. Creators keep ownership of everything they
        make — putting work on {SITE.name} is a licence to stream it, not a transfer of copyright,
        and it&rsquo;s non-exclusive, so you stay free to distribute it anywhere else too.
      </p>

      <h2>Accessibility</h2>
      <p>
        We caption what we can and mark clearly on every episode page which accessibility features
        are available — including flashing-light warnings for photosensitive viewers. We&rsquo;re
        not where we want to be on this yet. If something isn&rsquo;t working for you, tell us at{' '}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we&rsquo;ll fix it.
      </p>

      <h2>Who runs it</h2>
      <p>
        {SITE.name} is operated by {SITE.studio}, {SITE.mailingAddress}. It&rsquo;s a small
        operation, which is why the catalogue grows deliberately rather than all at once.
      </p>

      <h2>Get in touch</h2>
      <p>
        <a href="/contact">Contact us</a> — or email{' '}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> directly. Real inbox, real
        person reading it.
      </p>
    </LegalLayout>
  );
}
