import { timingSafeEqual } from 'node:crypto';
import { getRoleContext } from '../../../lib/roles';
import { runSweepDay } from '../../../lib/studioMoney';
import { sendError } from '../../../lib/apiErrors';

// Studio money's sweep day. Runs daily at 10:00 UTC (vercel.json) and
// does nothing unless today is the sweep day: then, in auto mode, it
// sends the sweep; in confirm mode it emails what's ready. Same
// authentication as the other crons (CRON_SECRET bearer), and a signed-in
// full admin can POST it by hand with ?force=1 to run the day's logic now.
function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCronRequest = Boolean(cronSecret) && typeof authHeader === 'string' && sameSecret(authHeader, `Bearer ${cronSecret}`);

  let force = false;
  if (!isCronRequest) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { isAdmin } = await getRoleContext(req);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
    force = req.query.force === '1' || Boolean(req.body && req.body.force);
  }

  try {
    const result = await runSweepDay({ force });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('cron/studio-sweep error:', err.message);
    return sendError(res, err, 'cron/studio-sweep');
  }
}
