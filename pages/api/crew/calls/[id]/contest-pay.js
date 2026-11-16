import { getAuth } from '@clerk/nextjs/server';
import { getCall } from '../../../../../lib/crewCalls';
import { contestCrewPayRefund } from '../../../../../lib/crewPay';
import { applyCors } from '../../../../../lib/cors';
import { sendError, internalError } from '../../../../../lib/apiErrors';

// The crew member answers a refund the poster asked for on their secured
// pay (migration 125): "It happened — tell the studio".
//   POST { responseId, note } → the call (their view) + { studioEmail }
// Only the person the pay was secured for, only while the refund's three
// days run, once. The money then stays held until a full admin decides on
// /admin/crew; the poster is told (never the note) and the studio emailed.
// Before 125: 503 { code: 'migration-125' }.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const callId = String(req.query.id || '');
  const { responseId, note } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(callId) || !/^[0-9a-f-]{36}$/i.test(String(responseId || ''))) return res.status(404).json({ error: 'Not found.' });
  try {
    const { studioEmail } = await contestCrewPayRefund({ userId, callId, responseId: String(responseId), note: typeof note === 'string' ? note : '' });
    // Plain errors from the read are internal: only a refusal's own line goes out.
    const view = await getCall(callId, { viewerId: userId }).catch((err) => { throw err && err.status ? err : internalError(err, 'crew/calls/contest-pay view'); });
    return res.status(200).json({ ...view, studioEmail });
  } catch (err) {
    // A refusal carries the code the app and the pages read (migration-125, contested, due…).
    if (err && err.code && err.status && !err.internal) return res.status(err.status).json({ error: err.message, code: err.code });
    return sendError(res, err, 'crew/calls/contest-pay', 'Could not send that right now.', { plainStatus: 400 });
  }
}
