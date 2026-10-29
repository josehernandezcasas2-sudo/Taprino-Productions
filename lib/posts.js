import { randomBytes } from 'node:crypto';
import { getSupabase } from './supabase';
import { isPrivateRef, removePrivate } from './privateStorage';
import { recordOrphan, storagePathFromUrl } from './orphanedMedia';
import { getAiSealFlags } from './userProfiles';

// Where a page or the app loads a post's photo or cover from. A private
// reference (every upload since 2026-10-29, and older ones once the
// Protection card's move has run) is served by /api/posts/<id>/media,
// which hands out the capped copy with the site's no-AI headers and a
// per-visitor ceiling; a plain http(s) value (an image put in the public
// bucket before then) is left where it is until the move.
function mediaUrl(id, kind, stored) {
  if (!stored) return null;
  if (isPrivateRef(stored)) return `/api/posts/${encodeURIComponent(id)}/media?kind=${kind}`;
  return /^https?:\/\//.test(stored) ? stored : null;
}

// What a page or the API may see of a post. The video's uid and stored
// manifest stay on the server (`internal` is for the routes that sign
// playback, serve media or check ownership): with them anyone could play
// the video without a token, or pull a full-size frame of any second
// from Cloudflare's thumbnail endpoint (security round, 2026-10-26). A
// video plays through /api/vertical/playback?episodeId=post:<id>; the
// stored image references (`imageRef`, `thumbnailRef`) are internal too.
function mapRow(row, { internal = false } = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    caption: row.caption || null,
    imageUrl: mediaUrl(row.id, 'photo', row.image_url),
    ...(internal ? { videoUid: row.video_uid || null, videoSrc: row.video_src || null, imageRef: row.image_url || null, thumbnailRef: row.thumbnail_url || null } : {}),
    // A photo post's thumbnail is just the photo. A video's is the image
    // admin uploaded with it, or the frame stored when the video was
    // protected; Cloudflare's own frame URL is never handed out.
    thumbnailUrl: row.kind === 'video'
      ? mediaUrl(row.id, 'cover', row.thumbnail_url)
      : mediaUrl(row.id, 'photo', row.image_url),
    durationSeconds: row.duration_seconds || null,
    createdAt: row.created_at
  };
}

// The author's "Not for AI training" switch (lib/userProfiles.js,
// migration 111) on every post, so a reel, the viewer and the profile
// grid can show the seal (2026-10-29). On by default.
async function withAuthorSeal(posts) {
  if (posts.length === 0) return posts;
  const flags = await getAiSealFlags(posts.map((p) => p.userId));
  return posts.map((p) => ({ ...p, aiSeal: flags[p.userId] !== false }));
}

export async function createPost({ userId, kind, caption, imageUrl, videoUid, videoSrc, thumbnailUrl, durationSeconds }) {
  const supabase = getSupabase();
  const id = `post-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const { error } = await supabase.from('posts').insert({
    id,
    user_id: userId,
    kind,
    caption: caption || null,
    image_url: imageUrl || null,
    video_uid: videoUid || null,
    video_src: videoSrc || null,
    thumbnail_url: thumbnailUrl || null,
    duration_seconds: durationSeconds || null,
    status: 'published'
  });
  if (error) throw new Error(`Could not save the post: ${error.message}`);
  return id;
}

// Feeds the vertical discover feed — most recent first, video posts only
// (a photo/text post has nothing to play, so it never belongs in a video
// swipe feed; it shows on the profile grid instead, see getPostsForUser).
export async function getRecentVideoPosts(limit = 40, { id = null } = {}) {
  const supabase = getSupabase();
  let q = supabase
    .from('posts')
    .select('*')
    .eq('status', 'published')
    .eq('kind', 'video');
  if (id) q = q.eq('id', id);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getRecentVideoPosts error:', error.message);
    return [];
  }
  return withAuthorSeal((data || []).map(mapRow));
}

// Everything one person has posted — both kinds — for their public
// profile grid, most recent first. `viewerId` is whoever's looking at
// the profile right now (may be nobody, may be the profile owner) — it
// only affects whether each post's likedByViewer comes back true.
export async function getPostsForUser(userId, viewerId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'published')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getPostsForUser error:', error.message);
    return [];
  }
  return withAuthorSeal(await attachLikeState((data || []).map(mapRow), viewerId));
}

// Every video post viewerId has liked, most-recently-liked first — the
// heart doubles as a bookmark: liking a snippet is what puts it in your
// own profile's "Saved Snippets" section (pages/profile/[userId].js).
// Scoped to kind:'video' on purpose, same as getRecentVideoPosts — a
// liked photo post doesn't have anywhere to surface yet.
export async function getLikedVideoPosts(viewerId) {
  if (!viewerId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('post_likes')
    .select('created_at, posts!inner(*)')
    .eq('user_id', viewerId)
    .eq('posts.kind', 'video')
    .eq('posts.status', 'published')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getLikedVideoPosts error:', error.message);
    return [];
  }
  const posts = (data || []).map((row) => mapRow(row.posts));
  return withAuthorSeal(await attachLikeState(posts, viewerId));
}

// One extra query across every post on the page rather than one per
// post — plenty for how few posts a single profile has right now (this
// is still the admin test feature, see createPost's own comment), and
// avoids N+1 round trips as that grows.
async function attachLikeState(posts, viewerId) {
  if (posts.length === 0) return posts;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('post_likes')
    .select('post_id, user_id')
    .in('post_id', posts.map((p) => p.id));
  if (error) {
    console.error('attachLikeState error:', error.message);
    return posts.map((p) => ({ ...p, likesCount: 0, likedByViewer: false }));
  }
  const counts = {};
  const likedByViewer = new Set();
  for (const row of data || []) {
    counts[row.post_id] = (counts[row.post_id] || 0) + 1;
    if (viewerId && row.user_id === viewerId) likedByViewer.add(row.post_id);
  }
  return posts.map((p) => ({
    ...p,
    likesCount: counts[p.id] || 0,
    likedByViewer: likedByViewer.has(p.id)
  }));
}

// Adds/removes viewerId's own like on postId, idempotently — liking an
// already-liked post just leaves it liked, same as toggling an unliked
// one from the other side. Returns the fresh state so the caller can
// trust the response over whatever it optimistically rendered client-
// side, in case two taps raced each other.
export async function toggleLike(postId, viewerId) {
  const supabase = getSupabase();
  const { data: existing, error: selectError } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', viewerId)
    .maybeSingle();
  if (selectError) throw new Error(`Could not check like status: ${selectError.message}`);

  if (existing) {
    const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', viewerId);
    if (error) throw new Error(`Could not unlike: ${error.message}`);
  } else {
    const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: viewerId });
    if (error) throw new Error(`Could not like: ${error.message}`);
  }

  const { count, error: countError } = await supabase
    .from('post_likes')
    .select('post_id', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (countError) throw new Error(`Could not get like count: ${countError.message}`);

  return { liked: !existing, likesCount: count || 0 };
}

export async function findPost(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('posts').select('*').eq('id', id).eq('status', 'published').maybeSingle();
  if (error) {
    console.error('findPost error:', error.message);
    return null;
  }
  return data ? mapRow(data, { internal: true }) : null;
}

// The row goes, then its images: a private copy is removed outright
// (nothing else refers to it), a public one is queued for the orphan
// cleanup like any other artwork. Best effort after the delete itself.
export async function deletePost(id) {
  const supabase = getSupabase();
  const { data: row } = await supabase.from('posts').select('image_url, thumbnail_url, caption').eq('id', id).maybeSingle();
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the post: ${error.message}`);
  for (const stored of [row && row.image_url, row && row.thumbnail_url]) {
    if (!stored) continue;
    if (isPrivateRef(stored)) {
      await removePrivate(stored).catch(() => false);
    } else {
      const path = storagePathFromUrl(stored);
      if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason: 'post deleted', context: (row && row.caption) || id });
    }
  }
}

// Caption-only edit — same scope decision social apps like Instagram make:
// the caption can change after the fact, but the photo/video itself can't
// be swapped without just deleting and reposting.
export async function updatePostCaption(id, caption) {
  const supabase = getSupabase();
  const { error } = await supabase.from('posts').update({ caption: caption || null }).eq('id', id);
  if (error) throw new Error(`Could not update the post: ${error.message}`);
}

// A report flags for admin review — it does not hide the post itself.
// Reporting the same post twice just updates the reason rather than doing
// anything more drastic, same rule pitch-comment-report.js already uses.
export async function reportPost(id, reason) {
  const supabase = getSupabase();
  const { error } = await supabase.from('posts').update({ reported: true, report_reason: reason || null }).eq('id', id);
  if (error) throw new Error(`Could not submit that report: ${error.message}`);
}
