import Link from 'next/link';
import WishlistButton from './WishlistButton';
import { PlayIcon, LockIcon, usePlayerIconOverrides } from './PlayerIcons';
import { contentTypeTag } from '../lib/contentTypeTags';
import { tierBadge } from '../lib/tierBadge';

const MAX_CARDS = 15;

export default function CategoryRow({ title, episodes, allSeries, currentId, onSelect, isWishlisted, onToggleWishlist, seeAllHref, viewCounts }) {
  const iconOverrides = usePlayerIconOverrides();
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
      return {
        type: 'series', key: info.id, rank, info, count: eps.length,
        tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free',
        // Ad-free only if every episode is — one ad-supported episode is
        // enough to call the whole show ad-supported.
        adsEnabled: eps.some((e) => e.adsEnabled !== false)
      };
    })
    .filter(Boolean);

  // Ranked by views descending, then capped. Ties (e.g. everything at 0
  // views on a fresh library) keep their original relative order —
  // .sort() is stable, so this never reshuffles unranked content
  // pointlessly between renders.
  const cards = [...standaloneCards, ...seriesCards]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_CARDS);

  return (
    <div className="cat-row">
      <div className="cat-row-heading">
        <span>{title}</span>
        {seeAllHref && <Link href={seeAllHref} className="see-all">See all</Link>}
      </div>

      <div className="cat-row-track">
        {cards.map((card) => card.type === 'standalone' ? (
          <div key={card.key} className="card-wrap row-card">
            {onToggleWishlist && (
              <WishlistButton isActive={isWishlisted(card.ep.id)} onToggle={() => onToggleWishlist(card.ep.id)} />
            )}
            <button
              className={`ep-card ${tierBadge(card.ep.tier, card.ep.adsEnabled).key} ${card.ep.id === currentId ? 'active' : ''}`}
              onClick={() => onSelect(card.ep)}
            >
              <div className="ep-thumb">
                {card.ep.thumbnail && <img src={card.ep.thumbnail} alt="" className="ep-thumb-img" />}
                <span className="ep-badge">{tierBadge(card.ep.tier, card.ep.adsEnabled).label}</span>
                {!card.ep.thumbnail && (card.ep.tier === 'premium' ? <><LockIcon size={13} src={iconOverrides.admin_lock} /> locked</> : <><PlayIcon size={13} src={iconOverrides.play} /> preview</>)}
              </div>
              <div className="ep-info">
                <h4>{card.ep.title}</h4>
                <span>{card.ep.runtime}</span>
                <span className={`type-line ${contentTypeTag(card.ep.contentType).key}`}>{contentTypeTag(card.ep.contentType).label}</span>
              </div>
            </button>
          </div>
        ) : (
          <div key={card.key} className="card-wrap row-card">
            {onToggleWishlist && (
              <WishlistButton isActive={isWishlisted(card.info.id)} onToggle={() => onToggleWishlist(card.info.id)} />
            )}
            <Link href={`/series/${card.info.id}`} className={`ep-card ${tierBadge(card.tier, card.adsEnabled).key}`}>
              <div className="ep-thumb">
                {card.info.thumbnail && <img src={card.info.thumbnail} alt="" className="ep-thumb-img" />}
                <span className="ep-badge">{tierBadge(card.tier, card.adsEnabled).label}</span>
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
    </div>
  );
}
