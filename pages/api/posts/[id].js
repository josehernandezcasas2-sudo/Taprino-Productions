import { getRoleContext } from '../../../lib/roles';
import { findPost, deletePost } from '../../../lib/posts';

// Cleanup valve for test posts — the author or an admin can remove one.
// Hard delete (not soft/status-based like episode moderation) since a
// post never goes through review in the first place; there's nothing to
// preserve an audit trail of.
export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
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

  try {
    await deletePost(id);
  } catch (err) {
    console.error('delete post error:', err.message);
    return res.status(500).json({ error: 'Could not delete the post.' });
  }
  return res.status(200).json({ ok: true });
}
