import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// AdSense reviewers specifically look for an About page as a legitimacy
// signal — "is a real organisation behind this, or is it a content farm."
// A two-line placeholder reads worse than none, so this says something
// real about what the platform is and who runs it. Designed as its own
// page (mockup: claude.ai/artifact/F44Jgi7nyujabUMnsTvsRU) rather than
// reusing LegalLayout's plain document shell — this isn't a legal text,
// it's the page a first-time visitor lands on to decide whether the
// platform is worth trusting.
export async function getServerSideProps({ req, res }) {
  // Caching: signed-out visitors — which includes every crawler, and the
  // AdSense reviewer — can hold a copy for an hour and revalidate in the
  // background for a day after that. A signed-in visitor still needs a
  // real header (their name, admin link, tier), so their copy is never
  // cached.
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
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

export default function About({ mainGenres, isSignedIn, isSubscriber, email, isAdmin, isCreator }) {
  return (
    <>
      <Head>
        <title>About — {SITE.name}</title>
        <meta
          name="description"
          content={`${SITE.name} is a streaming platform run by ${SITE.studio} for independent film and series work.`}
        />
      </Head>

      <HeaderNav
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <main id="main-content" className="stage stage-single about-page">
        <div className="about-hero">
          <span className="about-eyebrow">About</span>
          <h1>Indie work has a distribution problem.</h1>
          <p className="about-hero-lede">We built a smaller, more deliberate screening room around it.</p>
          <p className="about-hero-sub">
            <strong>{SITE.name}</strong> is a streaming service and networking app run by {SITE.studio}, designed
            for indie films and projects. A lot of what&rsquo;s here is free with ads. They help maintain the site
            and fund new projects that not only help the community but tell the story of the creator.
          </p>
        </div>

        <div className="about-divider" aria-hidden="true" />

        <section className="about-section">
          <div className="about-section-label">01 — What this is</div>
          <div className="about-section-body">
            <p>
              {SITE.name} exists because independent work has a distribution problem. Finishing a short film or
              a series is hard enough; getting it in front of people who&rsquo;d actually want to watch it is
              somehow harder. Most platforms either bury independent work under an algorithm tuned for something
              else, or ask creators to build an audience from nothing before they&rsquo;ll pay attention.
            </p>
            <p className="about-pull">
              We take a smaller, more deliberate approach: work is <strong>reviewed and programmed</strong>{' '}
              rather than uploaded and forgotten. Every title here was watched by a person before it went live.
            </p>
          </div>
        </section>

        <section className="about-section">
          <div className="about-section-label">02 — How it works</div>
          <div className="about-cards">
            <div className="about-card">
              <span className="about-card-tag about-card-tag-mint">For viewers</span>
              <p>
                Most of the catalogue is free and supported by advertising — no account needed to watch, but an
                account is highly recommended. Making a free account adds a watchlist and remembers where you
                left off across devices.
              </p>
            </div>
            <div className="about-card">
              <span className="about-card-tag about-card-tag-brass">For creators</span>
              <p>
                We don&rsquo;t run open uploads. Creators <Link href="/apply">apply</Link>, and if the work
                isn&rsquo;t a fit, we&rsquo;ll let you know. When it is, we work with creators so their work can
                be shown not just on our platform but others too — we handle the encoding, captioning, and
                publishing ourselves.
              </p>
            </div>
          </div>
        </section>

        <section className="about-section">
          <div className="about-callout">
            <div className="about-section-label">03 — Accessibility</div>
            <p>
              We caption what we can and mark clearly on every episode page which accessibility features are
              available — including flashing-light warnings for photosensitive viewers. We&rsquo;re not where we
              want to be on this yet. If something isn&rsquo;t working for you, tell us at{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we&rsquo;ll fix it.
            </p>
          </div>
        </section>

        <section className="about-section">
          <div className="about-section-label">04 — Who runs it</div>
          <div>
            <p className="about-masthead-line">
              Operated by <strong>{SITE.studio}</strong>, {SITE.mailingAddress}.
            </p>
            <p className="about-masthead-sub">
              It&rsquo;s a small operation, which is why the catalogue grows deliberately rather than all at
              once.
            </p>
            <p className="about-masthead-date">Last updated August 13, 2026</p>
          </div>
        </section>

        <div className="about-cta">
          <div>
            <h2>Get in touch</h2>
            <p>Real inbox, real person reading it. We might take a while... but we&rsquo;ll get to it.</p>
          </div>
          <div className="about-cta-links">
            <Link href="/contact" className="about-cta-btn">Contact us →</Link>
            <a href={`mailto:${SITE.contactEmail}`} className="about-cta-email">{SITE.contactEmail}</a>
          </div>
        </div>
      </main>

      <Footer />
      <MobileTabBar />
    </>
  );
}
