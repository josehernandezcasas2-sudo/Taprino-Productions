import { getRoleContext } from '../../../lib/roles';
import { addEarmark, addExplanation, createSweep, getMoneyPage, releaseEarmark, saveStudioSettings, StudioMoneyError } from '../../../lib/studioMoney';

// /admin/money: the studio's Stripe balance, what has to stay, what can
// leave, the sweep, earmarks, explanations and the rules. Full admins
// only: this sends real money to the bank.
export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getMoneyPage());
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const who = { createdBy: userId, adminEmail: email || null };
      switch (body.action) {
        case 'sweep':
          return res.status(200).json({ sweep: await createSweep({ ...who, note: body.note || null }) });
        case 'earmark':
          return res.status(200).json({ earmark: await addEarmark({ label: body.label, cents: body.cents, note: body.note, ...who }) });
        case 'release':
          return res.status(200).json({ earmark: await releaseEarmark({ id: body.id, releasedBy: userId, adminEmail: email || null }) });
        case 'explain':
          return res.status(200).json({ explanation: await addExplanation({ cents: body.cents, explanation: body.explanation, ...who }) });
        case 'settings':
          return res.status(200).json({ settings: await saveStudioSettings(body.settings || {}, { adminId: userId, adminEmail: email || null }) });
        default:
          return res.status(400).json({ error: 'Unknown action.' });
      }
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err instanceof StudioMoneyError ? err.status : 500;
    if (status >= 500) console.error('admin/money error:', err.message);
    return res.status(status).json({ error: err.message });
  }
}
