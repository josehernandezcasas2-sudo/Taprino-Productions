import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { sendCollectReminders } from '../../../lib/creatorShareBatch';
import { releaseDueCrewPay } from '../../../lib/crewPay';
import { payeeCutoverStep, realignPriceOwners, repairTitlePayees } from '../../../lib/payees';
import { runStripeCatchup } from '../../../lib/stripeCatchup';
import { catchupAuditLine } from '../../../lib/stripeCatchupRules';
import { recordAudit } from '../../../lib/auditLog';
import { sendError } from '../../../lib/apiErrors';
import { handleStripeEvent } from '../webhook';

// Daily: "time to collect" reminders for creators who left (Terms section
// 5) — lib/creatorShareBatch.js sendCollectReminders — and, since
// 2026-10-28, the secured crew pay whose release hold has lifted
// (lib/crewPay.js releaseDueCrewPay; migration 114), and since slice 3b
// who gets paid: the one-off cut-over step (lib/payees.js
// payeeCutoverStep: from PAYEE_RULE_FROM a contributor's episode in
// someone else's show pays the show's paid account, written into its
// history, the uploader told once), the daily repair of any history row
// that disagrees with the titles (repairTitlePayees), and prices set before
// 3b pointed at whoever runs the title (realignPriceOwners), and since
// 2026-11-12 the Stripe catch-up (lib/stripeCatchup.js: webhook events whose
// work never finished run again through the webhook's own handler, and paid
// membership invoices whose invoice.paid never got through are recorded),
// with its counts in the audit log. Vercel's cron sends
// `Authorization: Bearer <CRON_SECRET>`, same as the other crons; a full
// admin can also POST it by hand.
function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCronRequest = Boolean(cronSecret) && typeof authHeader === 'string' && sameSecret(authHeader, `Bearer ${cronSecret}`);
  let adminId = 'cron';
  let adminEmail = 'cron (scheduled)';
  if (!isCronRequest) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { isAdmin, userId, email } = await getRoleContext(req);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    adminId = userId;
    adminEmail = email || null;
  }
  try {
    const result = await sendCollectReminders();
    const crewPay = await releaseDueCrewPay().catch((err) => { console.error('releaseDueCrewPay:', err.message); return { released: 0, error: true }; });
    const payeeCutover = await payeeCutoverStep().catch((err) => { console.error('payeeCutoverStep:', err.message); return { ran: false, error: true }; });
    const payeeRepair = await repairTitlePayees().catch((err) => { console.error('repairTitlePayees:', err.message); return { repaired: 0, error: true }; });
    // Prices set before 3b by a contributor follow whoever runs the title.
    const priceOwners = await realignPriceOwners().catch((err) => { console.error('realignPriceOwners:', err.message); return { moved: 0, error: true }; });
    if (payeeCutover.ran || payeeRepair.repaired || payeeRepair.invitesWithdrawn || payeeRepair.invitesFinished || payeeRepair.stuckWithdrawn || priceOwners.moved) console.log(`cron/creator-reminders payees: cut-over ${payeeCutover.stamped || 0} stamped, ${payeeCutover.told || 0} told; repair ${payeeRepair.repaired || 0} rows, ${payeeRepair.invitesWithdrawn || 0} invites withdrawn; acceptances that stopped part-way: ${payeeRepair.invitesFinished || 0} finished, ${payeeRepair.stuckWithdrawn || 0} withdrawn; ${priceOwners.moved || 0} prices now with whoever runs the title`);
    // Last, with its own clock: the Stripe catch-up. Never throws past here.
    const stripeCatchup = await runStripeCatchup({ handleEvent: handleStripeEvent }).catch((err) => { console.error('runStripeCatchup:', err.message); return { error: 'it couldn’t run (see the logs)' }; });
    await recordAudit({ adminId, adminEmail, action: 'stripe_catchup', targetType: 'creator_share', targetId: 'daily', details: `${isCronRequest ? 'cron' : 'manual'} · ${catchupAuditLine(stripeCatchup)}` });
    return res.status(200).json({ ok: true, checked: result.checked, reminded: result.sent.filter((s) => !s.skipped).length, skipped: result.sent.filter((s) => s.skipped).length, crewPay, payeeCutover, payeeRepair, priceOwners, stripeCatchup });
  } catch (err) {
    console.error('cron/creator-reminders error:', err.message);
    return sendError(res, err, 'cron/creator-reminders');
  }
}
