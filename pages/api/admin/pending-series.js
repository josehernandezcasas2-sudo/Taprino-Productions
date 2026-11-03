import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { invalidateCache } from '../../../lib/redis';
import { sendError } from '../../../lib/apiErrors';
import { ShowError, makeShowPublic } from '../../../lib/showPage';

// Caller-less since the merged review queue (kept, like the other orphaned
// admin routes CLAUDE.md lists). Its "approved" goes through
// lib/showPage.js makeShowPublic, the review queue's Make it public
// (decision 2 of the series revamp): only a private show with an approved
// episode, with public_at, the release clock, the trailers' protection,
// the audit line and the owner's notification. It used to set any show's
// status straight to approved, an empty one included. "rejected" only
// touches a show still waiting, as the queue's reject does.
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('series')
      .select('id, name, description, poster, thumbnail, submitted_by, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) return sendError(res, error, 'admin/pending-series');
    return res.status(200).json({ series: data || [] });
  }

  if (req.method === 'POST') {
    const { seriesId, decision } = req.body || {};
    if (!seriesId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'seriesId and a valid decision (approved/rejected) are required.' });
    }
    if (decision === 'approved') {
      try {
        const result = await makeShowPublic(String(seriesId), { userId, email, isAdmin });
        return res.status(200).json({ ok: true, publicAt: result.publicAt, released: result.released });
      } catch (err) {
        if (err instanceof ShowError) return res.status(err.status).json({ error: err.message });
        return sendError(res, err, 'admin/pending-series');
      }
    }
    const { data: changed, error } = await supabase
      .from('series')
      .update({ status: decision, reviewed_by: email, reviewed_at: new Date().toISOString() })
      .eq('id', String(seriesId))
      .eq('status', 'pending')
      .select('id');
    if (error) return sendError(res, error, 'admin/pending-series');
    if (!changed || changed.length === 0) return res.status(409).json({ error: 'This series was already reviewed. Reload the list.' });
    await invalidateCache('all_series_approved_v1');

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `series_${decision}`,
      targetType: 'series',
      targetId: String(seriesId)
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
