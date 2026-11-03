import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';
import { setEpisodeRemoval } from '../../../lib/showPage';

// This never deletes a row — it only flags one for an admin to act on
// (see pages/api/admin/resolve-deletion.js). Setting deletion_requested
// to true DOES immediately hide it from public reads (see
// lib/publicEpisodes.js / lib/episodes.js), since a creator asking for
// their own content to come down shouldn't have to wait on a review
// cycle for that part — only the permanent row removal waits on an admin.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
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

  // The write, the cache and the audit line are the episode editor's own
  // (lib/showPage.js setEpisodeRemoval, POST /api/show/episode/[id]/removal);
  // this route keeps its checks and its answers for Your work and the app.
  try {
    await setEpisodeRemoval(existing.id, { action, reason: String(reason || '') }, { userId, isAdmin }, { strict: false });
  } catch (err) {
    return sendError(res, err, 'creator/request-episode-deletion', 'Could not save your request.');
  }

  return res.status(200).json({ ok: true, episodeId, deletionRequested: action === 'request' });
}
