// The one way an API route answers an error it caught (2026-10-28).
//
// An error thrown on purpose carries a status and a line written for the
// person (validation, not found, forbidden, "not set up yet" with 503):
// that line goes out as it is. Anything else — a database error, Stripe,
// a bug — names tables, ids and internals, so it is logged here with the
// route's name and the browser gets a plain line (the security round's
// rule, 2026-10-26: a user-facing 500 never echoes error.message).
//
// Security round 2 (2026-10-28): the libraries that throw plain Errors
// for both ("Pick an amount" and `throw new Error(error.message)` from a
// database call alike) mark the second kind with internalError(), which
// keeps the cause for the log and is never echoed. A route whose library
// uses plain Errors for its validation lines passes `plainStatus` (400),
// and those lines still reach the person; a marked error does not.
export function internalError(cause, context = '') {
  const text = cause && cause.message ? cause.message : String(cause || 'unknown error');
  const err = new Error(context ? `${context}: ${text}` : text);
  err.status = 500;
  err.internal = true;
  err.cause = cause;
  return err;
}

export function sendError(res, err, route = 'api', fallback = 'Something went wrong. Please try again.', { plainStatus = 0 } = {}) {
  const status = Number(err && err.status) || 0;
  const internal = Boolean(err && err.internal);
  if (!internal && status >= 400 && status < 600 && err.message) {
    return res.status(status).json({ error: err.message });
  }
  if (!internal && !status && plainStatus && err && err.message) {
    return res.status(plainStatus).json({ error: err.message });
  }
  console.error(`${route}:`, err && err.message ? err.message : err);
  return res.status(500).json({ error: fallback });
}
