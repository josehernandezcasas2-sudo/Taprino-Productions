import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { sendCollectReminders } from '../../../lib/creatorShareBatch';
import { creditYearlyMonths } from '../../../lib/creatorShare';
import { releaseDueCrewPay, refundDueCrewPay } from '../../../lib/crewPay';
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
// with its counts in the audit log, and since 2026-11-16 the refunds posters
// asked for on secured crew pay whose three days are up with no answer from
// the crew member (lib/crewPay.js refundDueCrewPay; migration 125), counted
// in an audit line of their own when there were any, and since 2026-11-19
// the yearly Stream plans' months after the first (lib/creatorShare.js
// creditYearlyMonths; migration 127): every yearly payment whose next month
// is due gets that month's share, split by the member's picks that day,
// counted in an audit line of its own when there was anything. Vercel's cron sends
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
    // Each step runs whatever the one before it did: a failed reminder run
    // must not keep the crew-pay releases, the payee steps or the Stripe
    // catch-up from running. The answer is still 500 when it failed.
    let remindersError = null;
    const result = await sendCollectReminders().catch((err) => { remindersError = err; console.error('sendCollectReminders:', err.message); return { checked: 0, sent: [] }; });
    const crewPay = await releaseDueCrewPay().catch((err) => { console.error('releaseDueCrewPay:', err.message); return { released: 0, error: true }; });
    const crewPayRefunds = await refundDueCrewPay().catch((err) => { console.error('refundDueCrewPay:', err.message); return { due: 0, refunded: 0, error: true }; });
    if (crewPayRefunds.due || crewPayRefunds.error) {
      await recordAudit({ adminId, adminEmail, action: 'crew_pay_refunds_due', targetType: 'crew_payment', targetId: 'daily', details: `${isCronRequest ? 'cron' : 'manual'} · ${crewPayRefunds.error ? 'it couldn’t run (see the logs)' : `${crewPayRefunds.due} due · ${crewPayRefunds.refunded} refunded · ${crewPayRefunds.busy || 0} busy · ${crewPayRefunds.failed || 0} failed`}` }).catch(() => null);
    }
    const payeeCutover = await payeeCutoverStep().catch((err) => { console.error('payeeCutoverStep:', err.message); return { ran: false, error: true }; });
    const payeeRepair = await repairTitlePayees().catch((err) => { console.error('repairTitlePayees:', err.message); return { repaired: 0, error: true }; });
    // Prices set before 3b by a contributor follow whoever runs the title.
    const priceOwners = await realignPriceOwners().catch((err) => { console.error('realignPriceOwners:', err.message); return { moved: 0, error: true }; });
    if (payeeCutover.ran || payeeRepair.repaired || payeeRepair.invitesWithdrawn || payeeRepair.invitesFinished || payeeRepair.stuckWithdrawn || priceOwners.moved) console.log(`cron/creator-reminders payees: cut-over ${payeeCutover.stamped || 0} stamped, ${payeeCutover.told || 0} told; repair ${payeeRepair.repaired || 0} rows, ${payeeRepair.invitesWithdrawn || 0} invites withdrawn; acceptances that stopped part-way: ${payeeRepair.invitesFinished || 0} finished, ${payeeRepair.stuckWithdrawn || 0} withdrawn; ${priceOwners.moved || 0} prices now with whoever runs the title`);
    // Last, with its own clock: the Stripe catch-up. Never throws past here.
    const stripeCatchup = await runStripeCatchup({ handleEvent: handleStripeEvent }).catch((err) => { console.error('runStripeCatchup:', err.message); return { error: 'it couldn’t run (see the logs)' }; });
    await recordAudit({ adminId, adminEmail, action: 'stripe_catchup', targetType: 'creator_share', targetId: 'daily', details: `${isCronRequest ? 'cron' : 'manual'} · ${catchupAuditLine(stripeCatchup)}` });
    // After the others, whatever they did: the yearly plans' months that
    // are due (lib/creatorShare.js; before migration 127 it finds none).
    const yearlyMonths = await creditYearlyMonths().catch((err) => { console.error('creditYearlyMonths:', err.message); return { error: true }; });
    if (yearlyMonths.error || yearlyMonths.credited || yearlyMonths.failed || yearlyMonths.waiting) {
      await recordAudit({ adminId, adminEmail, action: 'yearly_months', targetType: 'creator_share', targetId: 'daily', details: `${isCronRequest ? 'cron' : 'manual'} · ${yearlyMonths.error ? 'it couldn’t run (see the logs)' : `${yearlyMonths.credited} month${yearlyMonths.credited === 1 ? '' : 's'} credited · ${yearlyMonths.finished || 0} year${yearlyMonths.finished === 1 ? '' : 's'} finished · ${yearlyMonths.failed || 0} failed · ${yearlyMonths.waiting || 0} waiting`}` }).catch(() => null);
    }
    if (remindersError) return sendError(res, remindersError, 'cron/creator-reminders');
    return res.status(200).json({ ok: true, checked: result.checked, reminded: result.sent.filter((s) => !s.skipped).length, skipped: result.sent.filter((s) => s.skipped).length, crewPay, crewPayRefunds, payeeCutover, payeeRepair, priceOwners, stripeCatchup, yearlyMonths });
  } catch (err) {
    console.error('cron/creator-reminders error:', err.message);
    return sendError(res, err, 'cron/creator-reminders');
  }
}
