import { getAccountContext } from './accountContext';
import { getRecentVideoPosts } from './posts';
import { getPublicIdentities } from './userProfiles';

// Shared by pages/snippets/discover.js and the mobile app's GET
// /api/snippets-feed — this page has no HeaderNav (full-bleed takeover,
// same as vertical/discover.js), so unlike genre/stream/type there's no
// web-only field split needed; both callers want exactly this shape.
export async function getSnippetsFeedData(req) {
  const account = await getAccountContext(req);
  const posts = await getRecentVideoPosts();
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
    authorAvatarUrl: authors[p.userId].avatarUrl
  }));

  return {
    snippetEpisodes,
    isSignedIn: account.isSignedIn,
    viewerId: account.userId
  };
}
