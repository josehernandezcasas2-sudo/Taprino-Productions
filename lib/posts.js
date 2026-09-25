import { getSupabase } from './supabase';
import { cloudflareThumbnailUrl } from './cloudflareUpload';

function mapRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    caption: row.caption || null,
    imageUrl: row.image_url || null,
    videoUid: row.video_uid || null,
    videoSrc: row.video_src || null,
    // A photo post's thumbnail is just the photo — nothing to override
    // there. A video's default thumbnail is whatever frame Cloudflare
    // happened to grab, which admin can now replace at upload time
    // (thumbnail_url); that custom one wins whenever it's set.
    thumbnailUrl: row.kind === 'video'
      ? (row.thumbnail_url || (row.video_uid ? cloudflareThumbnailUrl(row.video_uid) : null))
      : (row.image_url || null),
    durationSeconds: row.duration_seconds || null,
    createdAt: row.created_at
  };
}

export async function createPost({ userId, kind, caption, imageUrl, videoUid, videoSrc, thumbnailUrl, durationSeconds }) {
  const supabase = getSupabase();
  const id = `post-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
export async function getRecentVideoPosts(limit = 40) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'published')
    .eq('kind', 'video')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('getRecentVideoPosts error:', error.message);
    return [];
  }
  return (data || []).map(mapRow);
}

// Everything one person has posted — both kinds — for their public
// profile grid, most recent first.
export async function getPostsForUser(userId) {
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
  return (data || []).map(mapRow);
}

export async function findPost(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('findPost error:', error.message);
    return null;
  }
  return data ? mapRow(data) : null;
}

export async function deletePost(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the post: ${error.message}`);
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
