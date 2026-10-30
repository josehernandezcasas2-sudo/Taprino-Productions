// Under the old magic-link system, this endpoint's job was "sign the visitor
// in by setting a cookie now that they've paid" — checkout could happen
// anonymously, so this was the first moment identity was established.
//
// Under Clerk, that's backwards: /api/create-checkout-session now requires
// being signed in first (see that file), so by the time anyone lands here,
// their Clerk session already exists and is already linked to this exact
// Stripe customer. There's nothing left to set — just send them back with
// a flag so the UI can show a welcome state. Their new subscription status
// gets picked up automatically on the next page load, same as every other
// account change in this app (the webhook is what records the payment).
//
// It used to look the session up in Stripe "as a sanity check" and throw
// the answer away: an unauthenticated, unlimited Stripe API call for anyone
// who hit the URL in a loop (security round, 2026-10-26). Nothing read the
// result, so the call is gone.
export default async function handler(req, res) {
  const { session_id: sessionId } = req.query;
  if (!sessionId) return res.redirect('/');

  // Joined from the account's Membership page (web, or the app's in-app
  // browser): land back there (the only other destination is the home
  // page, so nothing else can be asked for here).
  const to = req.query.to === 'account' ? '/account/membership' : '/';
  res.writeHead(302, { Location: `${to}?welcome=1` });
  return res.end();
}
