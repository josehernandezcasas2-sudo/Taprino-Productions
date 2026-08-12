import Link from 'next/link';

// Simple emoji-based icons rather than custom illustrations — swap these for
// real artwork any time by replacing the emoji strings below, no other code
// needs to change.
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

export default function GenreBrowseRow({ genres }) {
  if (!genres || genres.length === 0) return null;

  return (
    <div className="cat-row genre-browse-row">
      <div className="cat-row-heading">Browse by Genre</div>
      <div className="genre-browse-track">
        {genres.map((g) => (
          <Link key={g} href={`/genre/${encodeURIComponent(g)}`} className="genre-browse-item">
            <div className="genre-browse-circle">{GENRE_ICONS[g] || '◆'}</div>
            <span>{g}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
