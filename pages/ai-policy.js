import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import BackButton from '../components/BackButton';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import { AiSealChip, AiSealStamp } from '../components/AiSeal';
import { SITE } from '../lib/siteConfig';

// The AI policy (Jose, 2026-10-25; canvas
// https://claude.ai/artifact/68Gq3NnvmRGaAYYinZ1KX5): what the site does
// to keep creators' work off training sets, in plain words, and what it
// cannot promise. The machine-readable reservation (TDM-Policy header,
// /.well-known/tdmrep.json) points here. Open while the private beta
// door is shut, like the other policy pages (lib/privateBetaRules.js).
// Every claim below describes something the code actually does; when a
// measure changes, change the sentence that describes it.
export async function getServerSideProps({ req, res }) {
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Cookie');
  }
  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
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

const UPDATED = 'October 25, 2026';

export default function AiPolicy({ account = {} }) {
  return (
    <>
      <Head>
        <title>{`Not for AI training — ${SITE.name}`}</title>
        <meta name="description" content={`Nothing on ${SITE.name} is licensed for AI training or text-and-data mining. What the site does about it, and what it can't promise.`} />
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

      <main className="stage stage-single legal-page aip-page">
        <BackButton fallbackHref="/stream" />

        <div className="aip-hero">
          <div>
            <div className="eyebrow">{SITE.name} · Policy</div>
            <h1>Not for AI training</h1>
            <p className="aip-lead">
              Everything on this site was made by people, for people to watch. None of it is licensed for training machine-learning or AI models, for text-and-data mining, or for building datasets. This page says what we do about that, and what we can&rsquo;t.
            </p>
          </div>
          <AiSealStamp size={128} />
        </div>

        <section className="aip-section">
          <h2>The short version</h2>
          <p>
            Nothing here is licensed for AI training. Not the films, series, podcasts or Snippets; not the captions, stills or posters; not the pitches, crew cards, places, lessons or profiles. That holds whether you are a company, a lab, a researcher or a hobbyist, and whether you crawl, scrape, download, screen-record or screenshot.
          </p>
          <p>
            Search engines may index the public pages so people can find the work. Indexing is not training, and we tell search crawlers so.
          </p>
        </section>

        <section className="aip-section">
          <h2>What we do about it</h2>
          <div className="aip-grid">
            <div className="aip-card">
              <div className="aip-kicker">01 · Crawlers</div>
              <h3>We tell them no.</h3>
              <p>Our robots file names every known AI training crawler and AI answer engine and turns them away. Every page carries a no-AI header, the European text-and-data-mining reservation, and a signal that says search yes, AI no.</p>
            </div>
            <div className="aip-card">
              <div className="aip-kicker">02 · Video</div>
              <h3>No permanent address.</h3>
              <p>Every title plays through a short-lived signed link, free titles included. A copied link stops working within hours. A Snippet&rsquo;s photo and cover are served by us from private storage, capped in size with the camera data stripped, never from a public address.</p>
            </div>
            <div className="aip-card">
              <div className="aip-kicker">03 · The words</div>
              <h3>Captions stay with the video.</h3>
              <p>Caption tracks, course files and people&rsquo;s paperwork live in private storage and only open for someone allowed to watch.</p>
            </div>
            <div className="aip-card">
              <div className="aip-kicker">04 · Reads</div>
              <h3>Rationed.</h3>
              <p>Catalogue and people pages are rate-limited per visitor. Only our own site and app can read the data behind them from a browser.</p>
            </div>
            <div className="aip-card">
              <div className="aip-kicker">05 · The app</div>
              <h3>Captures come out black.</h3>
              <p>Screenshots and screen recording are blocked while a title plays in the {SITE.name} app.</p>
            </div>
            <div className="aip-card">
              <div className="aip-kicker">06 · The seal</div>
              <h3>The work says so itself.</h3>
              <p>Creators can show a &ldquo;Not for AI training&rdquo; mark on their titles and profile. It links here.</p>
            </div>
          </div>
        </section>

        <section className="aip-section aip-honest">
          <h2>What we can&rsquo;t promise</h2>
          <p>
            These signals are requests. The large AI companies document honouring them; not everyone does, and a crawler that lies about its name gets past a robots file. Nothing stops a person with a camera pointed at a screen, or a signed-in human copying what they see. A model that was trained on something cannot be made to forget it.
          </p>
          <p>
            We are a small studio. We would rather say that plainly than pretend otherwise, and keep closing the doors we can close.
          </p>
        </section>

        <section className="aip-section">
          <h2>If you make work here</h2>
          <p>
            The policy covers everything on the site. You don&rsquo;t have to switch anything on. The seal is yours to show or hide: <Link href="/account">Account</Link> &rarr; Profile &rarr; <em>Show the &ldquo;Not for AI training&rdquo; seal on my work</em>. It is on from the day you join.
          </p>
          <div className="aip-seal-row">
            <AiSealChip />
            <small>how it looks on a title page</small>
          </div>
          <p>
            We will never license your work for AI training, and we don&rsquo;t train models on it ourselves. If that ever changed, it would need your separate written agreement first, for that use and that work. The <Link href="/terms#ai">Terms</Link> say the same in their own words.
          </p>
        </section>

        <div className="aip-grid" style={{ marginBottom: '2.4rem' }}>
          <section className="aip-section aip-box">
            <h2>If you find our work in a dataset</h2>
            <p>
              Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with the title, where you saw it, and anything you saved. A person reads every one. We ask for its removal and tell the creator what we did.
            </p>
          </section>
          <section className="aip-section aip-box">
            <h2>If you run an AI company</h2>
            <p>
              Don&rsquo;t crawl this site. There is nothing here to license by default, and &ldquo;publicly available&rdquo; is not a licence. If you believe you have a lawful basis for something specific, write first.
            </p>
          </section>
        </div>

        <p className="aip-fine">
          Last updated {UPDATED} · See the <Link href="/terms#ai">Terms</Link>, sections 5 and 6 · This page is what our machine-readable reservation points to.
        </p>

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
