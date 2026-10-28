import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { sendCollectReminders } from '../../../lib/creatorShareBatch';
import { releaseDueCrewPay } from '../../../lib/crewPay';
import { sendError } from '../../../lib/apiErrors';

// Daily: "time to collect" reminders for creators who left (Terms section
// 5) — lib/creatorShareBatch.js sendCollectReminders — and, since
// 2026-10-28, the secured crew pay whose release hold has lifted
// (lib/crewPay.js releaseDueCrewPay; migration 114). Vercel's cron sends
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
  if (!isCronRequest) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { isAdmin } = await getRoleContext(req);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  }
  try {
    const result = await sendCollectReminders();
    const crewPay = await releaseDueCrewPay().catch((err) => { console.error('releaseDueCrewPay:', err.message); return { released: 0, error: true }; });
    return res.status(200).json({ ok: true, checked: result.checked, reminded: result.sent.filter((s) => !s.skipped).length, skipped: result.sent.filter((s) => s.skipped).length, crewPay });
  } catch (err) {
    console.error('cron/creator-reminders error:', err.message);
    return sendError(res, err, 'cron/creator-reminders');
  }
}
