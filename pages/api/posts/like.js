import { getAuth } from '@clerk/nextjs/server';
import { toggleLike, findPost } from '../../../lib/posts';

// Mirrors pages/api/posts/report.js — signed in and the post has to
// actually exist, nothing more. Anyone signed in can like anyone's
// post, including their own (same as most social apps — there's no
// reason to special-case it).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to like a post.' });
  }

  const { postId } = req.body || {};
  if (!postId) return res.status(400).json({ error: 'postId is required.' });

  const post = await findPost(postId);
  if (!post) return res.status(404).json({ error: 'Not found.' });

  try {
    const result = await toggleLike(postId, userId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('post like error:', err.message);
    return res.status(500).json({ error: 'Could not update that like.' });
  }
}
