import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/router';
import BackButton from '../../components/BackButton';
import { getSeriesHubData } from '../../lib/seriesHub';
import { useWishlist } from '../../lib/useWishlist';
import HeaderNav from '../../components/HeaderNav';
import SeriesHero from '../../components/SeriesHero';
import MobileTabBar from '../../components/MobileTabBar';
import PreviewBar, { PreviewFootnote } from '../../components/PreviewBar';
import { PlayIcon, LockIcon, usePlayerIconOverrides } from '../../components/PlayerIcons';
import { ChevronIcon } from '../../components/show/roomBits';
import { SITE, absoluteSiteUrl } from '../../lib/siteConfig';
import { tierBadge } from '../../lib/tierBadge';
import { parseRuntimeToSeconds } from '../../lib/videoMetadata';
import { seriesPlayLabel, freePlayNote, episodeCode } from '../../lib/seriesResume';
import { rowTierWord, episodeCodeOf } from '../../lib/showRules';
import { extraMetaLine } from '../../lib/extraKinds';
import { BundleCard, BuyChip, OwnedChip, BoughtBanner, useBuyTitle } from '../../components/BuyBits';

import Footer from '../../components/Footer';

export async function getServerSideProps({ req, params, res, query }) {
  // ?preview=1: the owner's private preview of a show that isn't public
  // (decision 2, amendment 5; slice 4) — never cached, whatever comes back.
  const preview = query.preview === '1';
  // CDN caching, but ONLY for signed-out visitors.
  //
  // This page returns per-user props (email, wishlist, isAdmin,
  // isSubscriber). Caching it publicly for everyone would let Vercel's CDN
  // serve one visitor's rendered HTML — including their email address and
  // admin status — to the next person for the life of the cache. That is a
  // real data leak, not a theoretical one.
  //
  // Signed-out visitors, though, all receive identical HTML, and they're
  // the overwhelming majority of traffic including every crawler. Caching
  // just that case captures most of the invocation saving with none of the
  // exposure. The Vary header is what keeps the two populations in
  // separate cache entries.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (preview) {
    res.setHeader('Cache-Control', 'private, no-store');
  } else if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  // ?season=2 opens that season's tab (lib/seriesHub.js answers `season`).
  const data = await getSeriesHubData(params.id, req, { season: typeof query.season === 'string' ? query.season : null, preview });
  if (!data) {
    return { notFound: true };
  }
  // A podcast lives at /podcasts/<id> (the series revamp: a show's kind),
  // with whatever the link carried (?bought=, ?preview=1, ...).
  if (data.redirect) {
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === 'id') continue;
      for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string') rest.append(key, v);
    }
    const qs = rest.toString();
    return { redirect: { destination: `${data.redirect}${qs ? `?${qs}` : ''}`, statusCode: 302 } };
  }

  // Buy to own: ?bought=<id> is Checkout bringing a buyer back.
  return { props: { ...data, bought: typeof query.bought === 'string' ? query.bought : null } };
}

// "23 min" from a "23:00" runtime (the episode page's spelling).
function minutesLabel(runtime) {
  const s = parseRuntimeToSeconds(runtime);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : (runtime || '');
}

function seasonNumberOf(e) {
  return Number.isInteger(Number(e.season)) && Number(e.season) > 0 ? Number(e.season) : 1;
}

// One episode on the series page (board V1; slice 4): the art with a play
// (or a lock) disc, the code with its FREE / TAPA + word in a mixed show,
// the title and the runtime, its own description, then Buy / Owned on the
// left and "Details" on the right when the episode has its own page. In a
// preview the foot carries the row's state instead ("IN REVIEW · sent 3 h
// ago"), and a contributor's row for someone else's episode isn't a link.
function EpisodeRow({ ep, rollup, offer, locked, preview, onBuy, buyBusy, iconOverrides }) {
  const code = episodeCodeOf(ep) || `Season ${seasonNumberOf(ep)}`;
  const word = rowTierWord(ep, rollup);
  const href = `/episode/${encodeURIComponent(ep.id)}?autoplay=1${preview ? '&preview=1' : ''}`;
  const openable = !preview || ep.canOpen !== false;
  const label = `${code}, ${ep.title}${locked ? ', locked' : ''}`;
  const inner = (
    <>
      <span className={`spg-thumb ${tierBadge(ep.tier, ep.adsEnabled).key}`}>
        {ep.thumbnail && <Image src={ep.thumbnail} alt="" fill sizes="(max-width: 899px) 120px, 176px" className="spg-thumb-img" />}
        {/* No play disc on a row this viewer can't open (a preview). */}
        {openable && (
          <span className="spg-disc" aria-hidden="true">
            {locked ? <LockIcon size={13} src={iconOverrides.admin_lock} /> : <PlayIcon size={13} src={iconOverrides.play} />}
          </span>
        )}
      </span>
      <span className="spg-head">
        <span className="spg-code-line">
          <span className="spg-code">{code}</span>
          {word && <span className={`spg-tierword ${word === 'Free' ? 'is-free' : 'is-plus'}`}>{word}</span>}
        </span>
        <span className="spg-title">{ep.title}</span>
        {ep.runtime && <span className="spg-runtime">{minutesLabel(ep.runtime)}</span>}
      </span>
      {ep.desc && <span className="spg-desc">{ep.desc}</span>}
    </>
  );
  const owned = Boolean(offer && offer.owned);
  return (
    <div className="spg-row" data-episode={ep.id}>
      {openable ? (
        <Link href={href} className="spg-top" aria-label={label}>{inner}</Link>
      ) : (
        <div className="spg-top is-static">{inner}</div>
      )}
      <div className="spg-foot">
        {preview ? (
          ep.previewNote ? (
            <span className="spg-note">
              <span className="pvbar-pill">{ep.previewNote.pill}</span>
              {ep.previewNote.note && <span className="spg-note-text">{ep.previewNote.note}</span>}
            </span>
          ) : <span />
        ) : (
          <span className="spg-foot-left">
            {owned ? <OwnedChip small /> : <BuyChip offer={offer} onBuy={onBuy} busy={buyBusy} />}
          </span>
        )}
        {ep.hasPage && openable && (
          <Link href={`/episode/${encodeURIComponent(ep.id)}${preview ? '?preview=1' : ''}`} className="spg-details" aria-label={`Details: ${ep.title} has its own page`}>
            Details <ChevronIcon size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

export default function SeriesHub({ seriesInfo, isSubscriber, isSignedIn, wishlist, email, seriesEpisodes, extraGroups = [], mainGenres, isAdmin, isCreator, crewCalls = [], crew = [], shotAt = [], bundle = null, episodeOffers = {}, bought = null, aiSeal = true, resume = null, heroTrailer = null, season = null, rollup = null, credits = [], year = null, seasons = [], preview = null }) {
  const router = useRouter();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist(isSignedIn, wishlist);
  const iconOverrides = usePlayerIconOverrides();
  const { buy: buyTitle, busy: buyBusy, error: buyError } = useBuyTitle({ isSignedIn });
  const ownsEp = (ep) => Boolean(episodeOffers[ep.id] && episodeOffers[ep.id].owned);
  const previewing = Boolean(preview);

  // Group by season — episodes without an explicit season are in season 1
  // (the sorter's rule). The server sends them in play order.
  const seasonNumbers = [...new Set(seriesEpisodes.map(seasonNumberOf))].sort((a, b) => a - b);
  const seasonList = seasonNumbers.map((n) => (seasons.find((s) => s.number === n) || { number: n, label: `Season ${n}` }));
  // The season the link asked for (?season=, checked by lib/seriesHub.js).
  const [activeSeason, setActiveSeason] = useState(seasonNumbers.includes(season) ? season : (seasonNumbers[0] || 1));
  const [activeTab, setActiveTab] = useState('episodes');
  const activeSeasonEpisodes = seriesEpisodes.filter((e) => seasonNumberOf(e) === activeSeason);
  const activeLabel = (seasonList.find((s) => s.number === activeSeason) || { label: `Season ${activeSeason}` }).label;

  // A season tab writes ?season= (no reload), so a shared link and a
  // reload open the same season.
  function pickSeason(n) {
    setActiveSeason(n);
    router.replace({ pathname: router.pathname, query: { ...router.query, season: String(n) } }, undefined, { shallow: true, scroll: false });
  }

  // The hero's trailer: the show's own, else its first episode's, signed
  // by lib/seriesHub.js (heroTrailer = { src, expiresAt, ref }; src null
  // when it couldn't be signed). With the ref the hero asks
  // /api/stream-token for a fresh link when its link runs out or fails,
  // and shows the artwork when there's nothing it can play.
  // heroImage (series-level or from the rep episode) always wins over
  // video when present.
  const heroEpisode = seriesEpisodes[0];
  // SECURITY: a trailer only, never the full episode's real src.
  const heroImage = seriesInfo.heroImage || (heroEpisode && heroEpisode.heroImage);
  const heroFallbackImage = heroTrailer ? (seriesInfo.thumbnail || seriesInfo.poster || (heroEpisode && (heroEpisode.thumbnail || heroEpisode.poster)) || null) : null;

  // About: the genre labels across the show's own episodes.
  const seriesGenres = [...new Set(seriesEpisodes.map((e) => e.genre).filter(Boolean))];
  const isOriginal = seriesInfo.isOriginal || seriesEpisodes.some((e) => e.isOriginal);
  const makerLine = (credits || []).find((c) => c.key === 'maker') || null;
  // What the bundle card calls the maker: the first name when the line is
  // an account's, else the whole line.
  const makerShort = makerLine ? (makerLine.href ? makerLine.name.split(/\s+/)[0] : makerLine.name) : null;
  const ownsSeries = Boolean(bundle && bundle.owned);
  const episodeCount = rollup ? rollup.episodeCount : seriesEpisodes.length;
  const seasonCount = rollup ? rollup.seasonCount : seasonNumbers.length;

  // Play: the first episode before the viewer has started the show, the
  // episode they're on once they have (lib/seriesResume.js), " · free" for
  // a non-member when that episode is free in a mixed show (decision 10).
  // A preview plays the first episode in preview.
  // In a preview it is the first episode this viewer may open (a
  // contributor opens only their own), and no Play when there is none.
  let playLabel = null;
  let playHref = null;
  if (previewing) {
    const firstOpen = seriesEpisodes.find((e) => e.canOpen !== false) || null;
    if (firstOpen) {
      playLabel = `Preview ${episodeCode(firstOpen) || 'first episode'}`;
      playHref = `/episode/${encodeURIComponent(firstOpen.id)}?preview=1&autoplay=1`;
    }
  } else if (heroEpisode) {
    const firstLabel = episodeCode(heroEpisode) ? `Play ${episodeCode(heroEpisode)}` : 'Play first episode';
    playLabel = seriesPlayLabel(resume, firstLabel, { free: freePlayNote({ resume, rollup, isMember: isSubscriber, ownsSeries }) });
    playHref = `/episode/${encodeURIComponent((resume && resume.episodeId) || heroEpisode.id)}?autoplay=1`;
  }

  // Link previews (row 8 of the slice 4 contract's table): landscape art.
  const ogImage = absoluteSiteUrl(seriesInfo.thumbnail) || absoluteSiteUrl(seriesInfo.poster) || absoluteSiteUrl(heroImage) || absoluteSiteUrl('/og-image.png');
  const ogDescription = (seriesInfo.desc || '').slice(0, 200);
  const extrasTotal = extraGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <Head>
        <title>{`${seriesInfo.name} — ${SITE.name}`}</title>
        <meta name="description" content={seriesInfo.desc || ''} />
        {previewing ? (
          <meta name="robots" content="noindex, nofollow" />
        ) : (
          <>
            <meta property="og:title" content={seriesInfo.name} />
            <meta property="og:description" content={ogDescription} />
            <meta property="og:image" content={ogImage} />
            <meta property="og:type" content="video.tv_show" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={seriesInfo.name} />
            <meta name="twitter:image" content={ogImage} />
          </>
        )}
      </Head>

      <HeaderNav
        activeCategory="All"
        activeType="All"
        mainGenres={mainGenres}
        isSignedIn={isSignedIn}
        email={email}
        isAdmin={isAdmin}
        isCreator={isCreator}
        isSubscriber={isSubscriber}
      />

      <PreviewBar preview={preview} />

      <SeriesHero
        title={seriesInfo.name}
        titleImageUrl={seriesInfo.titleImageUrl}
        desc={seriesInfo.desc}
        videoSrc={heroTrailer ? heroTrailer.src : null}
        trailerRef={heroTrailer ? heroTrailer.ref : null}
        trailerExpiresAt={heroTrailer ? heroTrailer.expiresAt : null}
        fallbackImageSrc={heroFallbackImage}
        imageSrc={heroImage}
        playLabel={playLabel}
        onPlay={playHref ? () => { window.location.href = playHref; } : null}
        tierLabel={heroEpisode ? tierBadge(heroEpisode.tier, heroEpisode.adsEnabled).label : null}
        tierKey={heroEpisode ? tierBadge(heroEpisode.tier, heroEpisode.adsEnabled).key : null}
        rollup={rollup}
        credits={credits}
        year={year}
        episodeCount={episodeCount}
        seasonCount={seasonCount}
        artist={heroEpisode ? heroEpisode.artist : null}
        isOriginal={isOriginal}
        isSaved={isWishlisted(seriesInfo.id)}
        onToggleSave={previewing ? null : () => toggleWishlist(seriesInfo.id)}
        aiSeal={aiSeal}
      />

      <main className="library-stage spg-stage">
        <BackButton fallbackHref="/stream" />

        <BoughtBanner bought={bought} title={bought && bought !== 'cancelled' && bundle && bundle.owned ? `${seriesInfo.name} (the whole series)` : seriesInfo.name} email={email} />
        {ownsSeries && (
          <p className="own-fine" style={{ margin: '0.8rem 0 1rem' }}>You own this series: every episode plays ad-free, including ones added later.</p>
        )}
        {!previewing && (
          <BundleCard
            bundle={bundle}
            series={seriesInfo}
            creatorName={makerShort}
            isSignedIn={isSignedIn}
            ownedCodes={Object.fromEntries(seriesEpisodes.map((e) => [e.id, episodeCodeOf(e) || e.title]))}
          />
        )}
        {buyError && <p className="own-error">{buyError}</p>}

        {/* Plain toggle buttons (aria-pressed, like the season chips): a
            tablist role promises arrow keys and panels this row doesn't have. */}
        <div className="series-tabs spg-tabs">
          <button type="button" aria-pressed={activeTab === 'episodes'} className={`series-tab ${activeTab === 'episodes' ? 'on' : ''}`} onClick={() => setActiveTab('episodes')}>Episodes</button>
          {extrasTotal > 0 && (
            <button type="button" aria-pressed={activeTab === 'extras'} className={`series-tab ${activeTab === 'extras' ? 'on' : ''}`} onClick={() => setActiveTab('extras')}>Extras</button>
          )}
          <button type="button" aria-pressed={activeTab === 'about'} className={`series-tab ${activeTab === 'about' ? 'on' : ''}`} onClick={() => setActiveTab('about')}>About</button>
        </div>

        {activeTab === 'episodes' && (
          seriesEpisodes.length === 0 ? (
            <div className="poster-empty">{previewing ? 'No episodes here yet. Episodes you send for review show up here.' : 'Nothing published in this series yet — check back soon.'}</div>
          ) : (
            <>
              {seasonList.length > 1 ? (
                <div className="season-tabs spg-seasons">
                  {seasonList.map((s) => (
                    <button
                      key={s.number}
                      type="button"
                      className={`season-tab ${s.number === activeSeason ? 'active' : ''}`}
                      aria-pressed={s.number === activeSeason}
                      onClick={() => pickSeason(s.number)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="series-season-heading">{activeLabel}</div>
              )}

              <div className="spg-list">
                {activeSeasonEpisodes.map((ep) => (
                  <EpisodeRow
                    key={ep.id}
                    ep={ep}
                    rollup={rollup}
                    offer={episodeOffers[ep.id]}
                    locked={ep.tier === 'premium' && !isSubscriber && !ownsEp(ep) && !ownsSeries && !previewing}
                    preview={previewing}
                    onBuy={() => buyTitle('episode', ep.id)}
                    buyBusy={buyBusy}
                    iconOverrides={iconOverrides}
                  />
                ))}
              </div>
            </>
          )
        )}

        {activeTab === 'extras' && (
          <div className="spg-extras">
            {extraGroups.map((g) => (
              <section key={g.key} className="spg-extra-group" aria-label={g.heading}>
                <h3 className="spg-extra-heading">{g.heading}</h3>
                <div className="spg-extra-grid">
                  {g.items.map((x) => {
                    const inner = (
                      <>
                        <span className="spg-extra-art">
                          {x.thumbnail && <Image src={x.thumbnail} alt="" fill sizes="(max-width: 639px) 46vw, (max-width: 899px) 30vw, 220px" className="spg-thumb-img" />}
                        </span>
                        <span className="spg-extra-title">{x.title}</span>
                        {/* "Making-of · 6 min" (migration 121), "Extra · 6 min" without a kind. */}
                        <span className="spg-extra-meta">{extraMetaLine(x.extraKind, x.runtime ? minutesLabel(x.runtime) : null)}</span>
                      </>
                    );
                    // In a preview, someone else's extra isn't a link (as the rows).
                    return previewing && x.canOpen === false ? (
                      <div key={x.id} className="spg-extra-card is-static">{inner}</div>
                    ) : (
                      <Link key={x.id} href={`/episode/${encodeURIComponent(x.id)}${previewing ? '?preview=1' : ''}`} className="spg-extra-card">{inner}</Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Crew Call posts linked to this series (migration 082). */}
        {activeTab === 'about' && crewCalls.length > 0 && (
          <div className="cc-list" style={{ maxWidth: 760, marginBottom: '1.4rem' }}>
            <div className="crew-eyebrow">Crew needed</div>
            {crewCalls.map((c) => (
              <Link key={c.id} href={`/crew/calls/${c.id}`} className="crew-panel cc-call">
                <div className="cc-title">{c.title}<span className={`cc-pay ${c.payType === 'paid' || c.payType === 'union' ? 'paid' : c.payType === 'deferred' ? 'deferred' : 'unpaid'}`}>{c.payLabel}</span></div>
                <div className="cc-when"><span>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''}</span><span>{c.remote ? 'Remote' : c.place}</span><span>{c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</span></div>
              </Link>
            ))}
          </div>
        )}
        {activeTab === 'about' && (
          <div className="series-about-grid">
            <div className="series-about-box">
              <div className="label">Genre</div>
              <div className="value">{seriesGenres.length > 0 ? seriesGenres.join(', ') : '—'}</div>
            </div>
            {(credits || []).map((c) => (
              <div key={c.key} className="series-about-box">
                <div className="label">{c.key === 'maker' ? c.label : c.key === 'studio' ? 'Studio' : 'Producer'}</div>
                <div className="value">{c.href ? <Link href={c.href}>{c.name}</Link> : c.name}</div>
              </div>
            ))}
            {year && (
              <div className="series-about-box">
                <div className="label">Year</div>
                <div className="value">{year}</div>
              </div>
            )}
            <div className="series-about-box">
              <div className="label">Rating</div>
              <div className="value">{rollup && rollup.rating && rollup.rating !== 'Not Rated' ? rollup.rating : 'Not rated'}</div>
            </div>
            <div className="series-about-box">
              <div className="label">Episodes</div>
              <div className="value">{episodeCount} across {seasonCount} season{seasonCount === 1 ? '' : 's'}</div>
            </div>
            {shotAt.length > 0 && (
              <div className="series-about-box">
                <div className="label">Shot at</div>
                <div className="value">{shotAt.map((s, i) => <span key={s.locationId}>{i > 0 ? ', ' : ''}<Link href={s.href}>{s.title}</Link>{s.city ? <small style={{ color: 'var(--ink-faint)' }}> ({s.city})</small> : null}</span>)}</div>
              </div>
            )}
            {crew.length > 0 && (
              <div className="series-about-box">
                <div className="label">Crew</div>
                <div className="value">{crew.map((c, i) => <span key={c.userId}>{i > 0 ? ', ' : ''}<Link href={c.profilePath}>{c.displayName}</Link> <small style={{ color: 'var(--ink-faint)' }}>({c.role})</small></span>)}</div>
              </div>
            )}
          </div>
        )}

        {previewing && <PreviewFootnote />}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}
