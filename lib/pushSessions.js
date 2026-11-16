import { clerkClient } from '@clerk/nextjs/server';
import { makeSessionChecker } from './pushSessionRules';

// SERVER-ONLY. Which sign-ins behind this instance's push rows have ended
// (lib/pushSessionRules.js says why and how often Clerk is asked). Used by
// lib/push.js (the app) and lib/webPush.js (browsers) before a send.

let lastErrorLog = 0;
function logOnce(err) {
  // Clerk unreachable: the pushes go out as before; one line a minute.
  if (Date.now() - lastErrorLog < 60 * 1000) return;
  lastErrorLog = Date.now();
  console.error('push sessions: Clerk couldn’t say whether a sign-in has ended; sending as before:', err && err.message);
}

async function clerkSessionStatus(sessionId) {
  try {
    const client = await clerkClient();
    const session = await client.sessions.getSession(sessionId);
    return session && typeof session.status === 'string' ? session.status : null;
  } catch (err) {
    // No such session here: no answer (never a reason to stop on its own).
    if (err && (err.status === 404 || (Array.isArray(err.errors) && err.errors.some((e) => e && e.code === 'resource_not_found')))) return null;
    throw err;
  }
}

const checker = makeSessionChecker({ fetchStatus: clerkSessionStatus, onError: logOnce });

// → a Set of the session ids among `sessionIds` whose sign-in has ended,
// been revoked or been removed. Never throws.
export async function endedPushSessions(sessionIds) {
  try {
    return await checker.stopped(sessionIds);
  } catch (err) {
    logOnce(err);
    return new Set();
  }
}
