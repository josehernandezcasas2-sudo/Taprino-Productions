import Link from 'next/link';

// Default emoji icons. Admins can override any of these per-genre with an
// uploaded image from /admin/genre-icons — see lib/genreIcons.js for how
// those overrides are fetched. A genre with no override just falls back to
// its emoji here, which is why this map still needs to stay complete.
const GENRE_ICONS = {
  Comedy: '😂',
  Action: '💥',
  Horror: '👻',
  'Science Fiction': '🛸',
  Fantasy: '⚔️',
  Romance: '💕',
  Documentary: '🎬',
  Mystery: '🔍',
  Animation: '🎨',
  Anime: '🌸'
};

export default function GenreBrowseRow({ genres, icons }) {
  if (!genres || genres.length === 0) return null;

  return (
    <div className="cat-row genre-browse-row">
      <div className="cat-row-heading">Browse by Genre</div>
      <div className="genre-browse-track">
        {genres.map((g) => {
          const custom = icons && icons[g];
          return (
            <Link key={g} href={`/genre/${encodeURIComponent(g)}`} className="genre-browse-item">
              <div className="genre-browse-circle">
                {custom ? <img src={custom} alt="" className="genre-browse-img" /> : (GENRE_ICONS[g] || '◆')}
              </div>
              <span>{g}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
