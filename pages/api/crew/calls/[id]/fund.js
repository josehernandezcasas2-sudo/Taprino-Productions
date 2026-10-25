import { getAuth } from '@clerk/nextjs/server';
import { getUserEmail } from '../../../../../lib/messages';
import { createCrewPayCheckout } from '../../../../../lib/crewPay';
import { requestOrigin } from '../../../../../lib/stripe';

// Pay secured (migration 110): the poster funds one booked person.
//   POST { responseId } → { url, paymentId, quote } — Stripe Checkout for the
//   rate + the studio's fee + card processing; back to the call afterwards
//   (?funded=<id> or ?funded=cancelled). The webhook marks it held.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const callId = String(req.query.id || '');
  const { responseId } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !/^[0-9a-f-]{36}$/i.test(String(responseId || ''))) return res.status(404).json({ error: 'Not found.' });
  try {
    const email = await getUserEmail(userId).catch(() => null);
    const out = await createCrewPayCheckout({ posterId: userId, posterEmail: email, callId, responseId, origin: requestOrigin(req) });
    return res.status(200).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('crew/calls/fund:', err.message);
    return res.status(500).json({ error: err.message || 'Could not start the payment right now.' });
  }
}
