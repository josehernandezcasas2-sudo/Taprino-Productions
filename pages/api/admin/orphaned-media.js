import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

// GET  → { orphans }: files nothing on the site uses any more (the Library's
//        Orphaned media list).
// POST { orphanId } → { ok }: Dismiss (the series revamp, slice 3a) — takes
//        the row off the list and leaves the file alone (Delete is
//        /api/admin/cleanup-orphan). manage_deletions; 120 an hour.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_deletions');
  if (!roleContext) return;

  const supabase = getSupabase();

  if (req.method === 'POST') {
    const orphanId = req.body && typeof req.body.orphanId === 'string' ? req.body.orphanId : '';
    if (!UUID.test(orphanId)) return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
    if (!(await checkRateLimit(`orphan-dismiss:${roleContext.userId}`, 120, 3600))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'That’s a lot in a row — give it a little while.' });
    }
    try {
      const { data: orphan, error: readError } = await supabase.from('orphaned_media').select('*').eq('id', orphanId).maybeSingle();
      if (readError) throw Object.assign(new Error(`orphaned-media read: ${readError.message}`), { internal: true });
      if (!orphan) return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
      const { data: gone, error } = await supabase.from('orphaned_media').delete().eq('id', orphanId).select('id');
      if (error) throw Object.assign(new Error(`orphaned-media dismiss: ${error.message}`), { internal: true });
      if (!gone || gone.length === 0) return res.status(404).json({ error: 'Not found — it may have already been cleaned up.' });
      await recordAudit({
        adminId: roleContext.userId,
        adminEmail: roleContext.email,
        action: 'dismiss_orphan',
        targetType: orphan.kind,
        targetId: orphan.reference,
        details: `Dismissed from the list (the file was left alone): ${orphan.context || orphan.reason || ''}`.slice(0, 900)
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return sendError(res, err, 'admin/orphaned-media', 'Could not dismiss this.');
    }
  }

  const { data, error } = await supabase
    .from('orphaned_media')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('orphaned-media error:', error.message);
    return res.status(500).json({ error: 'Could not load orphaned media.' });
  }

  return res.status(200).json({
    orphans: (data || []).map((o) => ({
      id: o.id,
      kind: o.kind,
      reference: o.reference,
      reason: o.reason,
      context: o.context,
      createdAt: o.created_at
    }))
  });
}
