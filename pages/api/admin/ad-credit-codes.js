import { getRoleContext } from '../../../lib/roles';
import { generateAdCreditCodes, listAdCreditCodes, setAdCreditCodeNoted } from '../../../lib/adCreditCodes';

const MAX_QUANTITY = 100;
const MAX_AMOUNT_CENTS = 100000; // $1,000 — generous ceiling, not a real-world expectation

export default async function handler(req, res) {
  const { isAdmin, email } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (req.method === 'GET') {
    const codes = await listAdCreditCodes();
    return res.status(200).json({ codes });
  }

  if (req.method === 'POST') {
    const { quantity, amountDollars, note } = req.body || {};
    const q = parseInt(quantity, 10);
    const amountCents = Math.round(Number(amountDollars) * 100);

    if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}.` });
    }
    if (!Number.isFinite(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
      return res.status(400).json({ error: `amountDollars must be between $0.01 and $${(MAX_AMOUNT_CENTS / 100).toFixed(2)}.` });
    }

    try {
      const codes = await generateAdCreditCodes({ quantity: q, amountCents, note, createdBy: email });
      return res.status(200).json({ codes });
    } catch (err) {
      console.error('generateAdCreditCodes error:', err.message);
      return res.status(500).json({ error: 'Could not generate codes. Try again.' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, noted } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id is required.' });
    }
    try {
      const code = await setAdCreditCodeNoted(id, noted);
      return res.status(200).json({ code });
    } catch (err) {
      console.error('setAdCreditCodeNoted error:', err.message);
      return res.status(500).json({ error: 'Could not update that code. Try again.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
