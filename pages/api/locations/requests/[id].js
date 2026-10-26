import { getRoleContext } from '../../../../lib/roles';
import { isStripeConfigured, requestOrigin } from '../../../../lib/stripe';
import { getRequest, answerRequest, acceptCounter, cancelRequest, createBookingCheckout, setOutcome, endorse } from '../../../../lib/locationRequests';
import { applyCors } from '../../../../lib/cors';

// One booking request, for either party (or an admin).
//   GET → { request }
//   PATCH { action: 'accept' | 'counter' (counter, note) | 'decline' (reason) }   host
//   PATCH { action: 'accept_counter' | 'pay' }                                    producer; pay → { url }
//   PATCH { action: 'cancel' (reason) }                                           either; refunds per policy once paid
//   PATCH { action: 'outcome', outcome, note }                                    host (or admin) after the last day
//   PATCH { action: 'endorse', line, wouldAgain }                                 either, after as_agreed
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const id = String(req.query.id || '');
  const rc = await getRoleContext(req);
  const userId = rc.userId || null;
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ request: await getRequest(id, { viewerId: userId, isAdmin: rc.isAdmin }) });
    }
    if (req.method === 'PATCH') {
      const body = req.body || {};
      switch (body.action) {
        case 'accept':
        case 'counter':
        case 'decline':
          return res.status(200).json({ request: await answerRequest(userId, id, body) });
        case 'accept_counter':
          return res.status(200).json({ request: await acceptCounter(userId, id) });
        case 'pay': {
          if (!isStripeConfigured()) return res.status(503).json({ error: 'Payments aren’t switched on for this site yet.' });
          return res.status(200).json(await createBookingCheckout(userId, id, { origin: requestOrigin(req) }));
        }
        case 'cancel':
          return res.status(200).json({ request: await cancelRequest(userId, id, body, { isAdmin: rc.isAdmin }) });
        case 'outcome':
          return res.status(200).json({ request: await setOutcome(userId, id, body, { isAdmin: rc.isAdmin }) });
        case 'endorse':
          return res.status(200).json({ request: await endorse(userId, id, body) });
        default:
          return res.status(400).json({ error: 'Unknown action.' });
      }
    }
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('location request [id]:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
  }
}
