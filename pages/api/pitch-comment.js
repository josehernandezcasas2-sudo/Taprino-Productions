import { getAuth } from '@clerk/nextjs/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getSupabase } from '../../lib/supabase';

const MAX_LENGTH = 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    // Comments require a signed-in account — not full identity
    // verification, but enough accountability that "post and vanish"
    // anonymous abuse isn't trivial, and enough that admin moderation has
    // an actual account to act on if needed.
    return res.status(401).json({ error: 'Sign in to leave a comment.' });
  }

  const { pitchId, body } = req.body || {};
  if (!pitchId || !body || !body.trim()) {
    return res.status(400).json({ error: 'A comment body is required.' });
  }
  if (body.length > MAX_LENGTH) {
    return res.status(400).json({ error: `Comments are limited to ${MAX_LENGTH} characters.` });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : null;

  const supabase = getSupabase();
  const { error } = await supabase.from('pitch_comments').insert({
    pitch_id: pitchId,
    user_id: userId,
    user_email: email,
    body: body.trim()
  });

  if (error) {
    console.error('pitch-comment error:', error.message);
    return res.status(500).json({ error: 'Could not post your comment right now.' });
  }
  return res.status(200).json({ ok: true });
}
