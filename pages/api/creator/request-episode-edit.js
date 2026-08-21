import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isAdmin } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const { episodeId, title, description } = req.body || {};
  if (!episodeId || (!title && !description)) {
    return res.status(400).json({ error: 'episodeId and at least one of title/description are required.' });
  }

  const supabase = getSupabase();
  const { data: episode, error: fetchError } = await supabase
    .from('episodes')
    .select('submitted_by, title, description')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !episode) {
    return res.status(404).json({ error: 'Episode not found.' });
  }
  if (!isAdmin && episode.submitted_by !== userId) {
    return res.status(403).json({ error: 'You can only request edits on your own episodes.' });
  }

  const updates = {};
  if (title && title.trim() && title.trim() !== episode.title) updates.pending_title = title.trim();
  if (description && description.trim() !== (episode.description || '')) updates.pending_description = description.trim();

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing actually changed from the current title/description.' });
  }

  const { error } = await supabase.from('episodes').update(updates).eq('id', episodeId);
  if (error) {
    console.error('request-episode-edit error:', error.message);
    return res.status(500).json({ error: 'Could not submit your edit request.' });
  }

  return res.status(200).json({ ok: true });
}
