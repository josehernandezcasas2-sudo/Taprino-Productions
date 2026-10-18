import { getAccountContext } from './accountContext';
import { getRecentVideoPosts } from './posts';
import { getPublicIdentities } from './userProfiles';

// Shared by pages/snippets/discover.js and the mobile app's GET
// /api/snippets-feed — this page has no HeaderNav (full-bleed takeover,
// same as vertical/discover.js), so unlike genre/stream/type there's no
// web-only field split needed; both callers want exactly this shape.
// postId: a post someone linked to (a profile's video grid). The feed is
// the 40 newest, so an older post is fetched and put first; it used to
// fall through to a random snippet.
export async function getSnippetsFeedData(req, { postId = null } = {}) {
  const account = await getAccountContext(req);
  const posts = await getRecentVideoPosts();
  if (postId && typeof postId === 'string' && !posts.some((p) => p.id === postId)) {
    const older = await getRecentVideoPosts(1, { id: postId });
    if (older.length) posts.unshift(older[0]);
  }
  const authors = await getPublicIdentities(posts.map((p) => p.userId));

  const snippetEpisodes = posts.map((p) => ({
    id: `post:${p.id}`,
    postId: p.id,
    ownerId: p.userId,
    title: p.caption || '',
    thumbnail: p.thumbnailUrl,
    videoSrc: p.videoSrc,
    seriesId: null,
    isUserPost: true,
    authorName: authors[p.userId].displayName,
    authorAvatarUrl: authors[p.userId].avatarUrl,
    authorAvatarPosition: authors[p.userId].avatarPosition || null,
    authorAvatarZoom: authors[p.userId].avatarZoom || null
  }));

  return {
    snippetEpisodes,
    isSignedIn: account.isSignedIn,
    viewerId: account.userId
  };
}
