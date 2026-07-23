import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// Same shape as request-episode-deletion.js. No ownership check on series
// (see series-media.js for why — any creator can manage series here,
// matching how the small trusted roster actually works), but this still
// never actually deletes anything itself — an admin has to confirm it in
// pages/api/admin/resolve-deletion.js, since removing a whole series can
// orphan episodes still pointing at it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { seriesId, action, reason } = req.body || {};
  if (!seriesId) {
    return res.status(400).json({ error: 'seriesId is required.' });
  }
  if (!['request', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'action must be "request" or "cancel".' });
  }
  if (action === 'request' && (!reason || String(reason).trim() === '')) {
    return res.status(400).json({ error: 'A reason is required to request deletion.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('series').select('id').eq('id', seriesId).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Series not found.' });
  }

  const dbUpdates = action === 'request'
    ? { deletion_requested: true, deletion_reason: reason, deletion_requested_at: new Date().toISOString() }
    : { deletion_requested: false, deletion_reason: null, deletion_requested_at: null };

  const { error } = await supabase.from('series').update(dbUpdates).eq('id', seriesId);

  if (error) {
    console.error('request-series-deletion error:', error.message);
    return res.status(500).json({ error: 'Could not save your request.' });
  }

  return res.status(200).json({ ok: true, seriesId, deletionRequested: action === 'request' });
}
