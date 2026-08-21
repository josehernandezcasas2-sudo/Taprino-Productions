import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

// Same approve/deny shape as resolve-artwork.js, for text fields instead
// of media — no orphan-cleanup step needed here since there's no storage
// artifact to reclaim when a text change is denied, just columns to clear.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { type, id, decision } = req.body || {};
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }

  const supabase = getSupabase();
  const table = type === 'episode' ? 'episodes' : 'series';
  const nameCol = type === 'episode' ? 'title' : 'name';
  const pendingNameCol = type === 'episode' ? 'pending_title' : 'pending_name';
  const selectCols = type === 'episode'
    ? `${nameCol}, description, pending_title, pending_description, submitted_by`
    : `${nameCol}, description, pending_name, pending_description`;

  const { data: row, error: fetchError } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();
  if (fetchError || !row) {
    return res.status(404).json({ error: 'Not found.' });
  }

  const context = row[nameCol];
  const clearPending = { [pendingNameCol]: null, pending_description: null };

  if (decision === 'deny') {
    const { error } = await supabase.from(table).update(clearPending).eq('id', id);
    if (error) {
      console.error('resolve-edit deny error:', error.message);
      return res.status(500).json({ error: 'Could not deny this change.' });
    }
    await recordAudit({ adminId: userId, adminEmail: email, action: `deny_${type}_edit`, targetType: type, targetId: id, details: context });
    if (type === 'episode') {
      await notifyCreator({ userId: row.submitted_by, type: 'edit_denied', message: `Your edit request for "${row.title}" was denied — it's unchanged.`, episodeId: id });
    }
    return res.status(200).json({ ok: true, type, id, decision: 'deny' });
  }

  const applyUpdates = { ...clearPending };
  if (row[pendingNameCol]) applyUpdates[nameCol] = row[pendingNameCol];
  if (row.pending_description) applyUpdates.description = row.pending_description;

  const { error } = await supabase.from(table).update(applyUpdates).eq('id', id);
  if (error) {
    console.error('resolve-edit approve error:', error.message);
    return res.status(500).json({ error: 'Could not approve this change.' });
  }

  await recordAudit({ adminId: userId, adminEmail: email, action: `approve_${type}_edit`, targetType: type, targetId: id, details: context });
  if (type === 'episode') {
    await notifyCreator({ userId: row.submitted_by, type: 'edit_approved', message: `Your edit request for "${applyUpdates.title || row.title}" was approved and is now live.`, episodeId: id });
  }

  return res.status(200).json({ ok: true, type, id, decision: 'approve' });
}
