import Link from 'next/link';
import { useRef } from 'react';
import WishlistButton from './WishlistButton';
import { SITE } from '../lib/siteConfig';

const MAX_CARDS = 15;
// Matches .row-card's width (190px) + .cat-row-track's gap (1.4rem ≈ 22px)
// in styles/globals.css — used to scroll by a sensible "page" of cards
// rather than an arbitrary pixel amount that doesn't line up with the
// actual card boundaries.
const CARD_STEP_PX = 212;

export default function CategoryRow({ title, episodes, allSeries, currentId, onSelect, isWishlisted, onToggleWishlist, seeAllHref, viewCounts }) {
  const trackRef = useRef(null);

  if (episodes.length === 0) return null;

  // Never show individual series episodes side by side in a browsing row —
  // consolidate every episode from the same show into one card for that
  // series, same rule as the /type/series page. Standalone movies/shorts
  // still get their own card each, since there's nothing to consolidate.
  const standalone = episodes.filter((e) => e.contentType !== 'series');
  const seriesIds = [...new Set(episodes.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];

  const vc = viewCounts || {};

  // Unified card list so both card types can be ranked and capped
  // together rather than as two separately-truncated lists — otherwise
  // "top 15" would really mean "top 15 standalone + top 15 series",
  // which isn't what "top 15 overall" means.
  const standaloneCards = standalone.map((ep) => ({
    type: 'standalone',
    key: ep.id,
    rank: vc[ep.id] || 0,
    ep
  }));
  const seriesCards = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = episodes.filter((e) => e.seriesId === sid);
      if (!info) return null;
      // A show's overall rank is the sum of its episodes' views — a
      // popular 6-episode show should generally outrank a single
      // lightly-watched standalone short, which a per-episode-only
      // comparison wouldn't reflect.
      const rank = eps.reduce((sum, e) => sum + (vc[e.id] || 0), 0);
      return { type: 'series', key: info.id, rank, info, count: eps.length, tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free' };
    })
    .filter(Boolean);

  // Ranked by views descending, then capped. Ties (e.g. everything at 0
  // views on a fresh library) keep their original relative order —
  // .sort() is stable, so this never reshuffles unranked content
  // pointlessly between renders.
  const cards = [...standaloneCards, ...seriesCards]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_CARDS);

  function scroll(direction) {
    const track = trackRef.current;
    if (!track) return;
    const visibleCards = Math.max(1, Math.floor(track.clientWidth / CARD_STEP_PX));
    const amount = CARD_STEP_PX * visibleCards;

    if (direction === 'next') {
      // Loops: clicking past the last card wraps back to the start rather
      // than doing nothing, so the row reads as an endless carousel even
      // though it's really just a fixed, ranked list of up to 15 items.
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + amount, behavior: 'smooth' });
    } else {
      const atStart = track.scrollLeft <= 4;
      track.scrollTo({ left: atStart ? track.scrollWidth : track.scrollLeft - amount, behavior: 'smooth' });
    }
  }

  return (
    <div className="cat-row">
      <div className="cat-row-heading">
        <span>{title}</span>
        {seeAllHref && <Link href={seeAllHref} className="see-all">See all</Link>}
      </div>

      <div className="cat-row-carousel">
        {cards.length > 1 && (
          <button className="cat-row-arrow left" onClick={() => scroll('prev')} aria-label={`Scroll ${title} left`}>
            ‹
          </button>
        )}

        <div className="cat-row-track" ref={trackRef}>
          {cards.map((card) => card.type === 'standalone' ? (
            <div key={card.key} className="card-wrap row-card">
              {onToggleWishlist && (
                <WishlistButton isActive={isWishlisted(card.ep.id)} onToggle={() => onToggleWishlist(card.ep.id)} />
              )}
              <button
                className={`ep-card ${card.ep.tier} ${card.ep.id === currentId ? 'active' : ''}`}
                onClick={() => onSelect(card.ep)}
              >
                <div className="ep-thumb">
                  {card.ep.thumbnail && <img src={card.ep.thumbnail} alt="" className="ep-thumb-img" />}
                  <span className="ep-badge">{card.ep.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                  {!card.ep.thumbnail && (card.ep.tier === 'premium' ? '◈ locked' : '▶ preview')}
                </div>
                <div className="ep-info">
                  <h4>{card.ep.title}</h4>
                  <span>{card.ep.runtime}</span>
                  <span className="type-line standalone">◆ Standalone {card.ep.contentType === 'movie' ? 'Movie' : 'Short'}</span>
                </div>
              </button>
            </div>
          ) : (
            <div key={card.key} className="card-wrap row-card">
              {onToggleWishlist && (
                <WishlistButton isActive={isWishlisted(card.info.id)} onToggle={() => onToggleWishlist(card.info.id)} />
              )}
              <Link href={`/series/${card.info.id}`} className={`ep-card ${card.tier}`}>
                <div className="ep-thumb">
                  {card.info.thumbnail && <img src={card.info.thumbnail} alt="" className="ep-thumb-img" />}
                  <span className="ep-badge">{card.tier === 'premium' ? SITE.premiumTier : 'Free with ads'}</span>
                  {!card.info.thumbnail && '▤ series'}
                </div>
                <div className="ep-info">
                  <h4>{card.info.name}</h4>
                  <span>{card.count} episode{card.count === 1 ? '' : 's'}</span>
                  <span className="type-line series">▤ Series</span>
                </div>
              </Link>
            </div>
          ))}
        </div>

        {cards.length > 1 && (
          <button className="cat-row-arrow right" onClick={() => scroll('next')} aria-label={`Scroll ${title} right`}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
