import { getRoleContext } from './roles';
import { canScheduleChannel } from './channelAccess';
import { sendError as sendApiError } from './apiErrors';

// Shared gate for /api/schedule/*: signed in, and allowed to schedule this
// particular channel. Sends the error response itself and returns null
// when the answer is no.
export async function requireScheduler(req, res, channelId) {
  const roleContext = await getRoleContext(req);
  if (!roleContext.userId) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  if (!channelId || typeof channelId !== 'string') {
    res.status(400).json({ error: 'Which channel? channelId is required.' });
    return null;
  }
  if (!(await canScheduleChannel(roleContext, channelId))) {
    res.status(403).json({ error: "You aren't assigned to schedule this channel." });
    return null;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return roleContext;
}

// The schedule routes' catch: a status-carrying error keeps its line,
// anything else is logged and answered plainly (lib/apiErrors.js).
export function sendError(res, err) {
  return sendApiError(res, err, 'schedule');
}
