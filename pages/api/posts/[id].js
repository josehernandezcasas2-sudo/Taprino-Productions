import { getRoleContext } from '../../../lib/roles';
import { findPost, deletePost, updatePostCaption } from '../../../lib/posts';

const MAX_CAPTION_LENGTH = 2200;

// Author-or-admin actions on one post: edit its caption, or delete it
// outright (a cleanup valve for test posts). Hard delete (not soft/
// status-based like episode moderation) since a post never goes through
// review in the first place — there's nothing to preserve an audit trail
// of.
export default async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'DELETE, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isAdmin } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const { id } = req.query;
  const post = await findPost(id);
  if (!post) {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (post.userId !== userId && !isAdmin) {
    return res.status(403).json({ error: 'Not your post.' });
  }

  if (req.method === 'PATCH') {
    const caption = typeof (req.body || {}).caption === 'string' ? req.body.caption.trim().slice(0, MAX_CAPTION_LENGTH) : '';
    if (!caption && post.kind === 'post' && !post.imageUrl) {
      return res.status(400).json({ error: 'A post needs a caption or a photo — this one has no photo, so the caption can’t be emptied.' });
    }
    try {
      await updatePostCaption(id, caption);
    } catch (err) {
      console.error('edit post error:', err.message);
      return res.status(500).json({ error: 'Could not save that edit.' });
    }
    return res.status(200).json({ ok: true, caption });
  }

  try {
    await deletePost(id);
  } catch (err) {
    console.error('delete post error:', err.message);
    return res.status(500).json({ error: 'Could not delete the post.' });
  }
  return res.status(200).json({ ok: true });
}
