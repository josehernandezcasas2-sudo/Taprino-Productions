import Head from 'next/head';
import Link from 'next/link';
import { getAccountContext } from '../lib/accountContext';
import { getPublicEpisodes } from '../lib/publicEpisodes';
import { getActiveAnnouncements } from '../lib/announcements';
import { getFeaturedCreators } from '../lib/userProfiles';
import { getApprovedPitches } from '../lib/pitches';
import { getAllSeries } from '../lib/series';
import { getCurrentLiveStream } from '../lib/liveStreams';
import { getViewCounts, isRedisConfigured } from '../lib/redis';
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
  const needsViewCounts = isRedisConfigured();
  const [episodes, announcements, featuredCreators, pitchRows, allSeries, liveStream, viewCounts] = await Promise.all([
    getPublicEpisodes(),
    getActiveAnnouncements(),
    getFeaturedCreators(4),
    getApprovedPitches(),
    getAllSeries(),
    getCurrentLiveStream(),
    needsViewCounts ? getViewCounts() : Promise.resolve({})
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

  // Series row — same "consolidate episodes into one card per show"
  // rule GenreRow uses on /stream, since the zine homepage never
  // surfaced series at all before this. Ranked by most recently active
  // (latest episode), same as the filmstrip above rather than a
  // separate sort convention.
  const seriesEpisodeList = episodes.filter((e) => e.contentType === 'series');
  const seriesIds = [...new Set(seriesEpisodeList.map((e) => e.seriesId))];
  const seriesRows = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = seriesEpisodeList.filter((e) => e.seriesId === sid);
      if (!info) return null;
      const latestCreatedAt = eps.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), eps[0].createdAt);
      return {
        id: info.id,
        title: info.name,
        poster: info.poster || info.thumbnail,
        count: eps.length,
        latestCreatedAt,
        views: eps.reduce((sum, e) => sum + (viewCounts[e.id] || 0), 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
    .slice(0, 8);

  // Trending — standalone titles and whole series ranked together by
  // view count, the same cross-type ranking GenreRow already does for
  // its own rows. Falls back to insertion order when nothing has views
  // yet (a fresh library, or Redis not configured), same as everywhere
  // else this ranking is used — never empty just because there's no
  // view data yet. The hero's own pick is excluded so the same title
  // doesn't appear twice in a row at the top of the page.
  const trending = [
    ...episodes
      .filter((e) => e.contentType !== 'series')
      .map((e) => ({ id: e.id, title: e.title, poster: e.poster || e.thumbnail, tag: e.contentType.toUpperCase(), views: viewCounts[e.id] || 0 })),
    ...seriesRows.map((s) => ({ id: s.id, title: s.title, poster: s.poster, tag: 'SERIES', views: s.views, isSeries: true }))
  ]
    .filter((item) => !heroItem || item.id !== heroItem.id)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

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
      pitches,
      seriesRows,
      trending,
      liveStream
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

        {trending.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker brass">TRENDING NOW</span></div>
            <div className="zine-filmstrip">
              {trending.map((item, i) => (
                <Link key={`${item.isSeries ? 'series' : 'ep'}-${item.id}`} href={item.isSeries ? `/series/${item.id}` : `/episode/${item.id}`} className="zine-filmstrip-item">
                  <div className="zine-filmstrip-poster" style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined}>
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

        {seriesRows.length > 0 && (
          <div className="zine-dept">
            <div className="zine-dept-label"><span className="zine-sticker sky">SERIES</span></div>
            <div className="zine-filmstrip">
              {seriesRows.map((s) => (
                <Link key={s.id} href={`/series/${s.id}`} className="zine-filmstrip-item">
                  <div className="zine-filmstrip-poster" style={s.poster ? { backgroundImage: `url(${s.poster})` } : undefined} />
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
