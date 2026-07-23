import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// This never deletes a row — it only flags one for an admin to act on
// (see pages/api/admin/resolve-deletion.js). Setting deletion_requested
// to true DOES immediately hide it from public reads (see
// lib/publicEpisodes.js / lib/episodes.js), since a creator asking for
// their own content to come down shouldn't have to wait on a review
// cycle for that part — only the permanent row removal waits on an admin.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, action, reason } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }
  if (!['request', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'action must be "request" or "cancel".' });
  }
  if (action === 'request' && (!reason || String(reason).trim() === '')) {
    return res.status(400).json({ error: 'A reason is required to request deletion.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, submitted_by')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Episode not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That episode does not belong to you.' });
  }

  const dbUpdates = action === 'request'
    ? { deletion_requested: true, deletion_reason: reason, deletion_requested_at: new Date().toISOString() }
    : { deletion_requested: false, deletion_reason: null, deletion_requested_at: null };

  const { error } = await supabase.from('episodes').update(dbUpdates).eq('id', episodeId);

  if (error) {
    console.error('request-episode-deletion error:', error.message);
    return res.status(500).json({ error: 'Could not save your request.' });
  }

  return res.status(200).json({ ok: true, episodeId, deletionRequested: action === 'request' });
}
