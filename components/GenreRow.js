import Link from 'next/link';
import WishlistButton from './WishlistButton';

export default function CategoryRow({ title, episodes, allSeries, currentId, onSelect, isWishlisted, onToggleWishlist }) {
  if (episodes.length === 0) return null;

  // Never show individual series episodes side by side in a browsing row —
  // consolidate every episode from the same show into one card for that
  // series, same rule as the /type/series page. Standalone movies/shorts
  // still get their own card each, since there's nothing to consolidate.
  const standalone = episodes.filter((e) => e.contentType !== 'series');
  const seriesIds = [...new Set(episodes.filter((e) => e.contentType === 'series').map((e) => e.seriesId))];
  const seriesCards = seriesIds
    .map((sid) => {
      const info = allSeries.find((s) => s.id === sid);
      const eps = episodes.filter((e) => e.seriesId === sid);
      return info ? { info, count: eps.length, tier: eps.some((e) => e.tier === 'premium') ? 'premium' : 'free' } : null;
    })
    .filter(Boolean);

  return (
    <div className="cat-row">
      <div className="cat-row-heading">{title}</div>
      <div className="cat-row-track">
        {standalone.map((ep) => (
          <div key={ep.id} className="card-wrap row-card">
            {onToggleWishlist && (
              <WishlistButton isActive={isWishlisted(ep.id)} onToggle={() => onToggleWishlist(ep.id)} />
            )}
            <button
              className={`ep-card ${ep.tier} ${ep.id === currentId ? 'active' : ''}`}
              onClick={() => onSelect(ep)}
            >
              <div className="ep-thumb">
                <span className="ep-badge">{ep.tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
                {ep.tier === 'premium' ? '◈ locked' : '▶ preview'}
              </div>
              <div className="ep-info">
                <h4>{ep.title}</h4>
                <span>{ep.runtime}</span>
                <span className="type-line standalone">◆ Standalone {ep.contentType === 'movie' ? 'Movie' : 'Short'}</span>
              </div>
            </button>
          </div>
        ))}

        {seriesCards.map(({ info, count, tier }) => (
          <div key={info.id} className="card-wrap row-card">
            {onToggleWishlist && (
              <WishlistButton isActive={isWishlisted(info.id)} onToggle={() => onToggleWishlist(info.id)} />
            )}
            <Link href={`/series/${info.id}`} className={`ep-card ${tier}`}>
              <div className="ep-thumb">
                <span className="ep-badge">{tier === 'premium' ? 'Cipher Circle' : 'Free'}</span>
                ▤ series
              </div>
              <div className="ep-info">
                <h4>{info.name}</h4>
                <span>{count} episode{count === 1 ? '' : 's'}</span>
                <span className="type-line series">▤ Series</span>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
