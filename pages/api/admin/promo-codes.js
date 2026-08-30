import { getRoleContext } from '../../../lib/roles';
import { generatePromoCodes, listPromoCodes, setPromoCodeNoted } from '../../../lib/promoCodes';

const MAX_QUANTITY = 100;
const MAX_DURATION_DAYS = 3650; // 10 years — generous ceiling, not a real-world expectation

export default async function handler(req, res) {
  const { isAdmin, email } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const codes = await listPromoCodes();
    return res.status(200).json({ codes });
  }

  if (req.method === 'POST') {
    const { quantity, durationDays, note } = req.body || {};
    const q = parseInt(quantity, 10);
    const d = parseInt(durationDays, 10);

    if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}.` });
    }
    if (!Number.isInteger(d) || d < 1 || d > MAX_DURATION_DAYS) {
      return res.status(400).json({ error: `durationDays must be between 1 and ${MAX_DURATION_DAYS}.` });
    }

    try {
      const codes = await generatePromoCodes({ quantity: q, durationDays: d, note, createdBy: email });
      return res.status(200).json({ codes });
    } catch (err) {
      console.error('generatePromoCodes error:', err.message);
      return res.status(500).json({ error: 'Could not generate codes. Try again.' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, noted } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id is required.' });
    }
    try {
      const code = await setPromoCodeNoted(id, noted);
      return res.status(200).json({ code });
    } catch (err) {
      console.error('setPromoCodeNoted error:', err.message);
      return res.status(500).json({ error: 'Could not update that code. Try again.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
