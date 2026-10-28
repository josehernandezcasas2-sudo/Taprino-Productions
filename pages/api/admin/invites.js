import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { checkRateLimit } from '../../../lib/rateLimit';
import { privateBetaOn } from '../../../lib/privateBetaRules';
import { getInvitesPage, inviteEmails, revokeInvitation, resendInvitation, dismissRequest } from '../../../lib/betaInvites';
import { sendError } from '../../../lib/apiErrors';

// /admin/invites. Full admins only: an invitation creates an account.
//   GET  → { enabled, available, invitations, requests, counts, clerkError }
//   POST { action: 'invite', emails: [..], note? }
//        { action: 'revoke', id } · { action: 'resend', id }
//        { action: 'dismiss', requestId }
export default async function handler(req, res) {
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      const page = await getInvitesPage();
      return res.status(200).json({ enabled: privateBetaOn(), ...page });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = req.body || {};
    if (body.action === 'invite' || body.action === 'resend') {
      // Real outreach fits; a runaway script doesn't.
      if (!(await checkRateLimit(`beta-invite:${rc.userId}`, 200, 86400))) {
        return res.status(429).json({ error: 'That’s 200 invites today. Try again tomorrow.' });
      }
    }
    if (body.action === 'invite') {
      const emails = Array.isArray(body.emails) ? body.emails : String(body.emails || '').split(/[\s,;]+/);
      const out = await inviteEmails({ emails, note: body.note, adminId: rc.userId });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'beta_invite_sent', targetType: 'invitation', details: `${out.sent.map((s) => s.email).join(', ') || 'none'}${out.failed.length ? ` · failed: ${out.failed.map((f) => f.email).join(', ')}` : ''}` }).catch(() => {});
      return res.status(200).json({ ok: true, ...out });
    }
    if (body.action === 'revoke') {
      const out = await revokeInvitation({ id: body.id });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'beta_invite_revoked', targetType: 'invitation', targetId: out.id, details: out.email }).catch(() => {});
      return res.status(200).json({ ok: true, ...out });
    }
    if (body.action === 'resend') {
      const out = await resendInvitation({ id: body.id, adminId: rc.userId });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'beta_invite_resent', targetType: 'invitation', targetId: body.id, details: out.sent.map((s) => s.email).join(', ') }).catch(() => {});
      return res.status(200).json({ ok: true, ...out });
    }
    if (body.action === 'dismiss') {
      await dismissRequest({ requestId: body.requestId, adminId: rc.userId });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'beta_request_dismissed', targetType: 'beta_request', targetId: body.requestId }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/invites error:', err.message);
    return sendError(res, err, 'admin/invites');
  }
}
