import Link from 'next/link';

// The poster's photo + name on a user-posted reel (Snippets, and user
// posts mixed into Vertical discover). Same photo as everywhere else —
// user_profiles.avatar_url from the account page — falling back to the
// brass letter circle, and links through to their public profile.
export default function ReelAuthor({ episode }) {
  const name = episode.authorName || 'A viewer';
  const avatarUrl = episode.authorAvatarUrl;
  return (
    <Link href={`/profile/${episode.ownerId}`} className="reel-caption-author">
      <span
        className="reel-caption-avatar"
        style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
      >
        {!avatarUrl && name[0].toUpperCase()}
      </span>
      <span className="reel-caption-series reel-caption-post-author">{name}</span>
    </Link>
  );
}
