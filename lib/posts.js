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
    thumbnailUrl: row.kind === 'video' && row.video_uid ? cloudflareThumbnailUrl(row.video_uid) : (row.image_url || null),
    durationSeconds: row.duration_seconds || null,
    createdAt: row.created_at
  };
}

export async function createPost({ userId, kind, caption, imageUrl, videoUid, videoSrc, durationSeconds }) {
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
