import { getRoleContext } from '../../../lib/roles';
import { recordAudit } from '../../../lib/auditLog';
import { listSuspensions, searchAccounts, getAccountCard, suspendAccount, liftSuspension } from '../../../lib/suspensions';

// /admin/accounts (migration 102; lib/suspensions.js). Full admins only:
// a suspension locks a person out.
//   GET                → { available, active, recent, scopes }
//   GET ?q=<text>      → { results: [{ userId, displayName, handle, joinedAt }] }
//   GET ?user=<id>     → { account } (counts, current state, history)
//   POST { action: 'suspend', userId, scope, publicReason, note, untilAt, cancelMembership }
//        { action: 'lift', userId, note }
export default async function handler(req, res) {
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      if (typeof req.query.user === 'string' && req.query.user) {
        return res.status(200).json({ account: await getAccountCard(req.query.user) });
      }
      if (typeof req.query.q === 'string') {
        return res.status(200).json({ results: await searchAccounts(req.query.q) });
      }
      return res.status(200).json(await listSuspensions({ limit: 100 }));
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = req.body || {};
    const userId = String(body.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    if (body.action === 'suspend') {
      const out = await suspendAccount({
        userId,
        scope: body.scope,
        publicReason: body.publicReason,
        note: body.note,
        untilAt: body.untilAt,
        cancelMembership: Boolean(body.cancelMembership),
        actorId: rc.userId,
        actorEmail: rc.email || null
      });
      recordAudit({
        adminId: rc.userId,
        adminEmail: rc.email || null,
        action: out.suspension.scope === 'tips' ? 'tips_blocked' : 'account_suspended',
        targetType: 'user',
        targetId: userId,
        details: `${out.suspension.publicReason}${out.suspension.untilAt ? ` · until ${out.suspension.untilAt.slice(0, 10)}` : ' · until lifted'}${out.suspension.cancelMembership ? ' · membership stops renewing' : ''}`
      }).catch(() => {});
      return res.status(200).json({ ok: true, ...out, account: await getAccountCard(userId) });
    }
    if (body.action === 'lift') {
      const out = await liftSuspension({ userId, note: body.note, actorId: rc.userId, actorEmail: rc.email || null });
      recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: 'suspension_lifted', targetType: 'user', targetId: userId, details: `${out.lifted.length} lifted${body.note ? ` · ${String(body.note).slice(0, 300)}` : ''}` }).catch(() => {});
      return res.status(200).json({ ok: true, ...out, account: await getAccountCard(userId) });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin/accounts error:', err.message);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
}
