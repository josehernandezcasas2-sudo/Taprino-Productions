import { getAuth } from '@clerk/nextjs/server';
import { reportPost, findPost } from '../../../lib/posts';

// Mirrors pages/api/pitch-comment-report.js — flags a post for admin
// review without hiding it. A single report shouldn't be able to
// silently take something down before a person looks at it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to report a post.' });
  }

  const { postId, reason } = req.body || {};
  if (!postId) return res.status(400).json({ error: 'postId is required.' });

  const post = await findPost(postId);
  if (!post) return res.status(404).json({ error: 'Not found.' });

  try {
    await reportPost(postId, reason);
  } catch (err) {
    console.error('post report error:', err.message);
    return res.status(500).json({ error: 'Could not submit that report.' });
  }
  return res.status(200).json({ ok: true });
}
