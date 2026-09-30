import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getHomeFeedData } from '../lib/homeFeed';
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
export async function getServerSideProps({ req, res }) {
  // Same signed-in-vs-anonymous split as stream.js/channel.js/etc. — this
  // is the most-visited page in the app and had no Cache-Control at all,
  // so every request (including every anonymous one that could safely
  // share a cached response) was hitting getServerSideProps fresh.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  }

  const account = await getAccountContext(req);
  const feed = await getHomeFeedData();

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      ...feed
    }
  };
}

function isExternalUrl(url) {
  return !!url && /^https?:\/\//i.test(url);
}

export default function Home({
  isSignedIn, isSubscriber, email, isAdmin, isCreator, mainGenres,
  announcements, featuredCreators, filmsAndShorts, podcasts, heroItem, pitches,
  seriesRows, trending, liveStream
}) {
  const cassetteColors = ['mint', 'sky', 'rust', 'brass'];
  const router = useRouter();

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

        {liveStream && (
          <div className="zine-hero" style={{ paddingBottom: 0 }}>
            <Link href="/live" className="zine-live-flash">
              <span className="live-dot" aria-hidden="true" />
              <span className="zine-live-flash-label">Special bulletin — live now</span>
              <span className="zine-live-flash-title">{liveStream.title}</span>
              <span className="zine-live-flash-cta">Tune in →</span>
            </Link>
          </div>
        )}

        {heroItem && (
          <div className="zine-hero">
            <div className="zine-hero-collage">
              <div className="zine-hero-art-wrap">
                <div className="zine-hero-art">
                  {(heroItem.poster || heroItem.heroImage) && (
                    <Image src={heroItem.poster || heroItem.heroImage} alt="" fill sizes="(max-width: 640px) 100vw, 380px" className="zine-fill-img" priority />
                  )}
                </div>
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

        {trending.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker brass">TRENDING NOW</span></div>
            <div className="zine-filmstrip">
              {trending.map((item, i) => (
                <Link key={`${item.isSeries ? 'series' : 'ep'}-${item.id}`} href={item.isSeries ? `/series/${item.id}` : `/episode/${item.id}`} className="zine-filmstrip-item">
                  <div className="zine-filmstrip-poster">
                    {item.poster && <Image src={item.poster} alt="" fill sizes="150px" className="zine-fill-img" />}
                    <span className="zine-trending-rank">#{i + 1}</span>
                  </div>
                  <h5>{item.title}</h5>
                  <span>{item.tag}</span>
                </Link>
              ))}
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
                  <div className="zine-polaroid-photo">
                    {c.avatarUrl && <Image src={c.avatarUrl} alt="" fill sizes="140px" className="zine-fill-img" />}
                  </div>
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
                  <div className="zine-filmstrip-poster">
                    {e.poster && <Image src={e.poster} alt="" fill sizes="150px" className="zine-fill-img" />}
                  </div>
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

        {seriesRows.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker sky">SERIES</span></div>
            <div className="zine-filmstrip">
              {seriesRows.map((s) => (
                <Link key={s.id} href={`/series/${s.id}`} className="zine-filmstrip-item">
                  <div className="zine-filmstrip-poster">
                    {s.poster && <Image src={s.poster} alt="" fill sizes="150px" className="zine-fill-img" />}
                  </div>
                  <h5>{s.title}</h5>
                  <span>{s.count} episode{s.count === 1 ? '' : 's'}</span>
                </Link>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Link href="/type/series" className="account-btn-secondary" style={{ width: 'auto', display: 'inline-block' }}>See all series →</Link>
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
                  {p.creatorName && (
                    p.creatorUserId ? (
                      <span
                        className="zine-flyer-by zine-flyer-by-link"
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/profile/${p.creatorUserId}`); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault(); e.stopPropagation();
                            router.push(`/profile/${p.creatorUserId}`);
                          }
                        }}
                      >
                        by {p.creatorName}
                      </span>
                    ) : (
                      <div className="zine-flyer-by">by {p.creatorName}</div>
                    )
                  )}
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

        {!isSubscriber && (
          <div className="zine-dept">
            <Link href="/account" className="zine-classified">
              <span className="zine-classified-eyebrow">Classifieds — Membership</span>
              <h4>WANTED: ad-free viewers to back the creators directly.</h4>
              <p>Early episodes, gated series, and a direct line to what you fund. Inquire within.</p>
              <span className="zine-classified-cta">Join {SITE.premiumTier} →</span>
            </Link>
          </div>
        )}
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
