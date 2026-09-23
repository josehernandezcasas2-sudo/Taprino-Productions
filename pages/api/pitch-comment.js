import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../lib/supabase';

const MAX_LENGTH = 1000;

export default async function handler(req, res) {
  const { userId } = getAuth(req);
  if (!userId) {
    // Comments require a signed-in account — not full identity
    // verification, but enough accountability that "post and vanish"
    // anonymous abuse isn't trivial, and enough that admin moderation has
    // an actual account to act on if needed.
    return res.status(401).json({ error: 'Sign in to leave a comment.' });
  }

  if (req.method === 'POST') {
    const { pitchId, body, parentCommentId } = req.body || {};
    if (!pitchId || !body || !body.trim()) {
      return res.status(400).json({ error: 'A comment body is required.' });
    }
    if (body.length > MAX_LENGTH) {
      return res.status(400).json({ error: `Comments are limited to ${MAX_LENGTH} characters.` });
    }

    const supabase = getSupabase();

    // A reply has to actually point at a real comment on the SAME pitch —
    // otherwise nothing stops a reply from being wired to an arbitrary id on
    // a different pitch entirely, which would show it in the wrong thread.
    if (parentCommentId) {
      const { data: parent } = await supabase.from('pitch_comments').select('pitch_id').eq('id', parentCommentId).maybeSingle();
      if (!parent || parent.pitch_id !== pitchId) {
        return res.status(400).json({ error: 'That comment no longer exists.' });
      }
    }

    // PRIVACY: no email is looked up or stored here anymore — the
    // commenter's public identity is resolved from their display name
    // (user_profiles) at READ time instead, never baked into the comment
    // row itself. See lib/userProfiles.js.
    const { error } = await supabase.from('pitch_comments').insert({
      pitch_id: pitchId,
      user_id: userId,
      parent_comment_id: parentCommentId || null,
      body: body.trim()
    });

    if (error) {
      console.error('pitch-comment error:', error.message);
      return res.status(500).json({ error: 'Could not post your comment right now.' });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { commentId, body } = req.body || {};
    if (!commentId || !body || !body.trim()) {
      return res.status(400).json({ error: 'A comment body is required.' });
    }
    if (body.length > MAX_LENGTH) {
      return res.status(400).json({ error: `Comments are limited to ${MAX_LENGTH} characters.` });
    }

    const supabase = getSupabase();
    // Ownership is checked here, not trusted from the client — only the
    // original commenter can edit their own comment, matched against the
    // real row rather than whatever the request claims.
    const { data: existing } = await supabase.from('pitch_comments').select('user_id, status').eq('id', commentId).maybeSingle();
    if (!existing || existing.status !== 'visible') {
      return res.status(404).json({ error: 'That comment no longer exists.' });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own comments.' });
    }

    const { error } = await supabase
      .from('pitch_comments')
      .update({ body: body.trim(), updated_at: new Date().toISOString() })
      .eq('id', commentId);
    if (error) {
      console.error('pitch-comment edit error:', error.message);
      return res.status(500).json({ error: 'Could not save your edit right now.' });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { commentId } = req.body || {};
    if (!commentId) return res.status(400).json({ error: 'commentId is required.' });

    const supabase = getSupabase();
    const { data: existing } = await supabase.from('pitch_comments').select('user_id, status').eq('id', commentId).maybeSingle();
    if (!existing || existing.status !== 'visible') {
      return res.status(404).json({ error: 'That comment no longer exists.' });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own comments.' });
    }

    // Same soft-delete as admin moderation (pages/api/admin/pitch-comments.js)
    // — status flips to 'deleted' rather than a hard row delete, so a
    // reply chain under this comment doesn't lose its parent record.
    const { error } = await supabase.from('pitch_comments').update({ status: 'deleted' }).eq('id', commentId);
    if (error) {
      console.error('pitch-comment delete error:', error.message);
      return res.status(500).json({ error: 'Could not delete that comment right now.' });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
