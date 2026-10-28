import { getRoleContext } from '../../../lib/roles';
import { endSale, getPricesForCreator, getPurchaseSettings, requestPrice, setSale, startSelling, stopSelling } from '../../../lib/purchases';
import { recordAudit } from '../../../lib/auditLog';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// The creator's half of Buy to own (My Work's "Sell this title" card and
// the app's equivalent). GET: every price of theirs plus the rules.
// POST { action, type, id, … }: set (cents) · stop · start · sale
// (percent, endsAt, membersOnly) · end_sale.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');
  const rc = await getRoleContext(req);
  if (!rc.userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!rc.isCreator && !rc.isAdmin) return res.status(403).json({ error: 'Creator access required.' });
  try {
    if (req.method === 'GET') {
      const [prices, settings] = await Promise.all([getPricesForCreator(rc.userId), getPurchaseSettings()]);
      return res.status(200).json({ prices, settings });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = req.body || {};
    const base = { type: body.type, id: body.id, userId: rc.userId, isAdmin: rc.isAdmin };
    const actions = {
      set: () => requestPrice({ ...base, cents: Math.round(Number(body.cents)) }),
      stop: () => stopSelling(base),
      start: () => startSelling(base),
      sale: () => setSale({ ...base, percent: body.percent, endsAt: body.endsAt, membersOnly: body.membersOnly }),
      end_sale: () => endSale(base)
    };
    if (!actions[body.action]) return res.status(400).json({ error: 'Unknown action.' });
    const row = await actions[body.action]();
    recordAudit({ adminId: rc.userId, adminEmail: rc.email || null, action: `title_price_${body.action}`, targetType: body.type, targetId: body.id, details: [body.cents ? `$${(Number(body.cents) / 100).toFixed(2)}` : null, body.percent ? `${body.percent}% until ${body.endsAt}` : null].filter(Boolean).join(' · ') || null }).catch(() => {});
    return res.status(200).json({ ok: true, price: row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('creator/pricing error:', err.message);
    return sendError(res, err, 'creator/pricing');
  }
}
