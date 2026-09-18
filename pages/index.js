import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getActiveAnnouncements } from '../lib/announcements';
import { getFeaturedCreators } from '../lib/userProfiles';
import { getApprovedPitches } from '../lib/pitches';
import HeaderNav from '../components/HeaderNav';
import InstallButton from '../components/InstallButton';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';

// The zine-style homepage — built from the approved mockup (Variant C:
// collage layout, rotated stickers, polaroid people cards). Replaced the
// earlier bare placeholder now that Jose picked a direction. Every
// section here uses real data with one honest exception: Featured
// People has no admin-curated "featured" flag yet (see
// lib/userProfiles.js getFeaturedCreators), so it shows the most
// recently active real creators instead — a reasonable stand-in until
// that curation exists, not a design shortcut.
export async function getServerSideProps({ req }) {
  const account = await getAccountContext(req);
  const [episodes, announcements, featuredCreators, pitchRows] = await Promise.all([
    getPublicEpisodes(),
    getActiveAnnouncements(),
    getFeaturedCreators(4),
    getApprovedPitches()
  ]);

  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const filmsAndShorts = episodes
    .filter((e) => e.contentType === 'movie' || e.contentType === 'short')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  const podcasts = episodes
    .filter((e) => e.contentType === 'podcast')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6);
  // Simple, honest hero pick for now: the most recent admin-flagged
  // "featured" item, falling back to the most recent film/short of any
  // kind so the hero is never empty just because nothing's been flagged.
  const heroItem = episodes.find((e) => e.featured) || filmsAndShorts[0] || null;
  const pitches = pitchRows.slice(0, 3).map((p) => ({
    id: p.id,
    title: p.title,
    tag: p.tag,
    logline: p.logline || p.description,
    fundingRaised: p.funding_raised,
    creatorName: p.creator_name || null
  }));

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      mainGenres,
      announcements,
      featuredCreators,
      filmsAndShorts,
      podcasts,
      heroItem,
      pitches
    }
  };
}

function isExternalUrl(url) {
  return !!url && /^https?:\/\//i.test(url);
}

export default function Home({
  isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres,
  announcements, featuredCreators, filmsAndShorts, podcasts, heroItem, pitches
}) {
  const cassetteColors = ['mint', 'sky', 'rust', 'brass'];

  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta name="description" content={`${SITE.studio} — ${SITE.premiumTier} streaming, funded projects, and more.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content">
        <div className="install-row" style={{ padding: '0 1.6rem' }}><InstallButton /></div>

        <div className="zine-masthead">
          <div>
            <span className="zine-masthead-title">{SITE.name}</span>
            <span className="zine-masthead-tag">SCREENING ROOM EDITION</span>
          </div>
        </div>

        {heroItem && (
          <div className="zine-hero">
            <div className="zine-hero-collage">
              <div className="zine-hero-art-wrap">
                <div
                  className="zine-hero-art"
                  style={heroItem.poster || heroItem.heroImage ? { backgroundImage: `url(${heroItem.poster || heroItem.heroImage})` } : undefined}
                />
                <div className="zine-hero-art-tag">NOW STREAMING</div>
              </div>
              <div className="zine-hero-text">
                <h2>{heroItem.title}</h2>
                {heroItem.desc && <p>{heroItem.desc}</p>}
                <Link href={`/episode/${heroItem.id}`} className="zine-sticker brass">▶ WATCH</Link>
              </div>
            </div>
          </div>
        )}

        {announcements.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker mint">ANNOUNCEMENTS</span></div>
            <div className="zine-brief-row">
              {announcements.map((a) => {
                const external = isExternalUrl(a.linkUrl);
                const Tag = a.linkUrl ? (external ? 'a' : Link) : 'div';
                const tagProps = a.linkUrl ? (external ? { href: a.linkUrl, target: '_blank', rel: 'noopener noreferrer' } : { href: a.linkUrl }) : {};
                return (
                  <Tag key={a.id} {...tagProps} className="zine-brief-card">
                    <div className="zine-brief-date">
                      {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}
                    </div>
                    <h4>{a.title}</h4>
                    {a.body && <p>{a.body}</p>}
                  </Tag>
                );
              })}
            </div>
          </div>
        )}

        {featuredCreators.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker sky">THE FACES BEHIND IT</span></div>
            <div className="zine-people-row">
              {featuredCreators.map((c) => (
                <Link key={c.userId} href={`/profile/${c.userId}`} className="zine-polaroid">
                  <div className="zine-polaroid-photo" style={c.avatarUrl ? { backgroundImage: `url(${c.avatarUrl})` } : undefined} />
                  <h5>{c.displayName}</h5>
                  <span className="zine-credit">{c.credits.slice(0, 2).join(', ')}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {filmsAndShorts.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker rust">FILMS &amp; SHORTS</span></div>
            <div className="zine-filmstrip">
              {filmsAndShorts.map((e) => (
                <Link key={e.id} href={`/episode/${e.id}`} className="zine-filmstrip-item">
                  <div className="zine-filmstrip-poster" style={e.poster ? { backgroundImage: `url(${e.poster})` } : undefined} />
                  <h5>{e.title}</h5>
                  <span>{e.contentType === 'movie' ? 'FILM' : 'SHORT'}{e.runtime ? ` · ${e.runtime}` : ''}</span>
                </Link>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Link href="/type/movie" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block' }}>See the full library →</Link>
            </div>
          </div>
        )}

        {podcasts.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker brass">ON AIR</span></div>
            <div className="zine-cassette-row">
              {podcasts.map((p, i) => (
                <Link key={p.id} href={`/episode/${p.id}`} className={`zine-cassette ${cassetteColors[i % cassetteColors.length]}`}>
                  <span className="zine-cassette-label">{p.title}</span>
                </Link>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Link href="/podcasts" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block' }}>See all podcasts →</Link>
            </div>
          </div>
        )}

        {pitches.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker mint">PITCH ROOM</span></div>
            <div className="zine-flyer-row">
              {pitches.map((p) => (
                <Link key={p.id} href={`/pitches/${p.id}`} className="zine-flyer">
                  <h4>{p.title}</h4>
                  {p.logline && <p>{p.logline}</p>}
                  {p.creatorName && <div className="zine-flyer-by">by {p.creatorName}</div>}
                  {p.fundingRaised != null && (
                    <div className="zine-flyer-raised">${Number(p.fundingRaised).toLocaleString()} raised</div>
                  )}
                </Link>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Link href="/pitches" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block' }}>See all projects →</Link>
            </div>
          </div>
        )}
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
