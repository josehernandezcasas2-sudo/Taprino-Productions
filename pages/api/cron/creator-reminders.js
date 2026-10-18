import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { sendCollectReminders } from '../../../lib/creatorShareBatch';

// Daily: "time to collect" reminders for creators who left (Terms section
// 5) — lib/creatorShareBatch.js sendCollectReminders. Vercel's cron sends
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
    return res.status(200).json({ ok: true, checked: result.checked, reminded: result.sent.filter((s) => !s.skipped).length, skipped: result.sent.filter((s) => s.skipped).length });
  } catch (err) {
    console.error('cron/creator-reminders error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
