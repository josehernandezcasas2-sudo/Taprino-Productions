import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// Only these three are valid draft types right now — episode drafts for
// creators, episode drafts for admin (kept separate from the creator one
// since the two forms have different field shapes and neither should
// accidentally load the other's draft), and pitch drafts for creators.
const VALID_TYPES = ['episode', 'admin_episode', 'pitch'];

export default async function handler(req, res) {
  const { type } = req.query;
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Unknown draft type.' });
  }

  const { userId, isAdmin, isCreator } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  // admin_episode drafts require admin; episode/pitch drafts require
  // creator — matches the same gates the actual submission forms use, so
  // someone can't read/write a draft for a form they can't access anyway.
  if (type === 'admin_episode' && !isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  if ((type === 'episode' || type === 'pitch') && !isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('content_drafts')
      .select('data, updated_at')
      .eq('user_id', userId)
      .eq('draft_type', type)
      .maybeSingle();
    if (error) {
      console.error('draft GET error:', error.message);
      return res.status(500).json({ error: 'Could not load draft.' });
    }
    return res.status(200).json({ draft: data ? data.data : null, updatedAt: data ? data.updated_at : null });
  }

  if (req.method === 'POST') {
    const { data } = req.body || {};
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data must be an object.' });
    }
    const { error } = await supabase
      .from('content_drafts')
      .upsert({ user_id: userId, draft_type: type, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,draft_type' });
    if (error) {
      console.error('draft POST error:', error.message);
      return res.status(500).json({ error: 'Could not save draft.' });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('content_drafts')
      .delete()
      .eq('user_id', userId)
      .eq('draft_type', type);
    if (error) {
      console.error('draft DELETE error:', error.message);
      return res.status(500).json({ error: 'Could not clear draft.' });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
