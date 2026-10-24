import { getRoleContext } from '../../../lib/roles';
import { forfeitExpired, getAdminSummary, runPayoutBatch } from '../../../lib/creatorShareBatch';
import { cancelCredits, clearLeaving, extendCollect, holdPayouts, markLeaving, releaseHold } from '../../../lib/creatorStanding';
import { resolveProfileUserId } from '../../../lib/userProfiles';
import { cancelScheduledNumbers, saveShareNumbers } from '../../../lib/creatorShareSettings';
import { recordAudit } from '../../../lib/auditLog';
import { dollars } from '../../../lib/artistSupportRules';

// /admin/creator-money: Creator Share's ledger summary, the next payout
// batch's plan and the button that runs it. Full admins only — this moves
// real money (Stripe Connect transfers from the platform balance).
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getAdminSummary());
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action;
      const standingActions = {
        hold: () => holdPayouts({ creatorId, reason: body.reason, adminId: userId }),
        release: () => releaseHold({ creatorId }),
        cancel: () => cancelCredits({ creatorId, cents: body.cents, note: body.note, adminId: userId }),
        leave: () => markLeaving({ creatorId, reason: body.reason, note: body.note, adminId: userId }),
        extend: () => extendCollect({ creatorId, until: body.until }),
        unleave: () => clearLeaving({ creatorId }),
        forfeit: () => forfeitExpired({ createdBy: userId, only: creatorId })
      };
      if (action === 'numbers' || action === 'cancel_numbers') {
        const result = action === 'numbers'
          ? await saveShareNumbers({ input: body.numbers, effectiveAt: body.effectiveAt || null, adminId: userId })
          : await cancelScheduledNumbers();
        recordAudit({
          adminId: userId,
          adminEmail: email || null,
          action: action === 'numbers' ? 'creator_share_numbers' : 'creator_share_numbers_cancel',
          targetType: 'creator_share',
          targetId: 'settings',
          details: action === 'numbers' ? `${result.applied ? 'applied now' : `scheduled for ${result.effectiveAt}`} · ${[...result.changes.adverse, ...result.changes.favourable].join('; ')}`.slice(0, 500) : 'scheduled change cancelled'
        }).catch(() => {});
        return res.status(200).json({ ok: true, ...result });
      }
      let creatorId = null;
      if (standingActions[action]) {
        // A creator by user id or @handle, as typed on the page.
        const raw = String(body.creator || '').trim().replace(/^@+/, '');
        creatorId = raw ? await resolveProfileUserId(raw) : null;
        if (!creatorId) return res.status(400).json({ error: 'No creator found with that user id or handle.' });
        const result = await standingActions[action]();
        recordAudit({
          adminId: userId,
          adminEmail: email || null,
          action: `creator_standing_${action}`,
          targetType: 'creator_share',
          targetId: creatorId,
          details: [body.reason, body.note, body.cents ? dollars(Number(body.cents)) : null, body.until].filter(Boolean).join(' · ').slice(0, 500) || null
        }).catch(() => {});
        return res.status(200).json({ ok: true, creatorId, result });
      }
      if (action !== 'run') return res.status(400).json({ error: 'Unknown action.' });
      const result = await runPayoutBatch({ createdBy: userId });
      recordAudit({
        adminId: userId,
        adminEmail: email || null,
        action: 'creator_payouts_run',
        targetType: 'creator_share',
        targetId: result.period,
        details: `${result.paid.length} paid (${dollars(result.paidCents)}) · ${result.failed.length} failed · ${result.skippedForBalance.length} waiting on balance · ${result.held.length} held${result.adShare ? ` · ad share ${result.adShare.error ? `failed: ${result.adShare.error}` : `${dollars(result.adShare.totalCents)} to ${result.adShare.creators || 0} creators for ${result.adShare.period}`}` : ''}`
      }).catch(() => {});
      return res.status(200).json(result);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('admin/creator-money error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
