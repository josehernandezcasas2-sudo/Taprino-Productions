// Per-request memo. Next.js hands every getServerSideProps call and API
// handler its own `req`, so a WeakMap keyed on it lives exactly as long as
// the request and is garbage-collected with it. Anything several helpers
// ask for during one page load — the Clerk user, the account bundle, the
// Stripe customer id — is fetched once and shared.
const store = new WeakMap();

export function memoByRequest(req, key, compute) {
  if (!req || typeof req !== 'object') return Promise.resolve().then(compute);
  let bag = store.get(req);
  if (!bag) {
    bag = new Map();
    store.set(req, bag);
  }
  if (!bag.has(key)) bag.set(key, Promise.resolve().then(compute));
  return bag.get(key);
}
