import Link from 'next/link';
import AvatarPhoto from './AvatarPhoto';
import { AiSealChip } from './AiSeal';

// The poster's photo + name on a user-posted reel (Snippets, and user
// posts mixed into Vertical discover). Same photo as everywhere else —
// user_profiles.avatar_url from the account page — falling back to the
// brass letter circle, and links through to their public profile. The
// author's "Not for AI training" seal (`aiSeal` on the feed item, from
// their own switch; 2026-10-29) sits beside the name, a link of its own
// rather than nested in the profile link.
export default function ReelAuthor({ episode }) {
  const name = episode.authorName || 'A viewer';
  const avatarUrl = episode.authorAvatarUrl;
  return (
    <div className="reel-caption-author-row">
      <Link href={`/profile/${episode.ownerId}`} className="reel-caption-author">
        <AvatarPhoto className="reel-caption-avatar" url={avatarUrl} position={episode.authorAvatarPosition} zoom={episode.authorAvatarZoom}>
          {name[0].toUpperCase()}
        </AvatarPhoto>
        <span className="reel-caption-series reel-caption-post-author">{name}</span>
      </Link>
      {episode.aiSeal === true && <AiSealChip className="reel-caption-seal" />}
    </div>
  );
}
