import { getRoleContext } from '../../../lib/roles';
import { hasCapability } from '../../../lib/capabilities';
import { recordAudit } from '../../../lib/auditLog';
import { listAllContent } from '../../../lib/contentAdmin';
import { getModerationState, flagContent, decide, setReporterStatus } from '../../../lib/moderation';

// GET  everything + reports/flags/reporters   (view_all_content or handle_flags)
// POST { op: 'flag', targetType, targetId, reason, note, emailOwner }
//      { op: 'decide', targetType, targetId, action: restore | take_down | ignore_reports | count_reports, note? }
//      { op: 'reporter', userId, status: cleared | muted | banned }
//      (handle_flags)
export default async function handler(req, res) {
  const rc = await getRoleContext(req);
  const canView = rc.isAdmin || hasCapability(rc, 'view_all_content') || hasCapability(rc, 'handle_flags');
  const canAct = rc.isAdmin || hasCapability(rc, 'handle_flags');
  if (!canView) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const [rows, moderation] = await Promise.all([listAllContent(), getModerationState()]);
      return res.status(200).json({ rows, moderation, canAct });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!canAct) return res.status(403).json({ error: "You don't have permission to flag or decide on content." });

    const b = req.body || {};
    if (b.op === 'flag') {
      await flagContent({ adminId: rc.userId, targetType: b.targetType, targetId: b.targetId, reason: b.reason, note: b.note, emailOwner: b.emailOwner !== false });
    } else if (b.op === 'decide') {
      await decide({ adminId: rc.userId, targetType: b.targetType, targetId: b.targetId, action: b.action, note: b.note });
    } else if (b.op === 'reporter') {
      await setReporterStatus({ userId: b.userId, status: b.status, adminId: rc.userId });
    } else {
      return res.status(400).json({ error: 'Unknown op.' });
    }
    await recordAudit({
      adminId: rc.userId,
      adminEmail: rc.email,
      action: b.op === 'flag' ? 'flag_content' : b.op === 'decide' ? `content_${b.action}` : `reporter_${b.status}`,
      targetType: b.op === 'reporter' ? 'user' : b.targetType,
      targetId: b.op === 'reporter' ? b.userId : b.targetId,
      details: b.reason || b.note || null
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
