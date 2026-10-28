// The one way an API route answers an error it caught (2026-10-28).
//
// An error thrown on purpose carries a status and a line written for the
// person (validation, not found, forbidden, "not set up yet" with 503):
// that line goes out as it is. Anything else — a database error, Stripe,
// a bug — names tables, ids and internals, so it is logged here with the
// route's name and the browser gets a plain line (the security round's
// rule, 2026-10-26: a user-facing 500 never echoes error.message).
export function sendError(res, err, route = 'api', fallback = 'Something went wrong. Please try again.') {
  const status = Number(err && err.status) || 0;
  if (status >= 400 && status < 600 && err.message) {
    return res.status(status).json({ error: err.message });
  }
  console.error(`${route}:`, err && err.message ? err.message : err);
  return res.status(500).json({ error: fallback });
}
