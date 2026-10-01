import { getAccountContext } from '../../lib/accountContext';

// Just the viewer's saved ids (episode ids and series ids, same list the
// website seeds useWishlist with from getServerSideProps) — the mobile
// app's library screens need it to draw filled/empty hearts without
// pulling the whole wishlist-feed. Signed-out viewers get an empty list.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const account = await getAccountContext(req);
  return res.status(200).json({ isSignedIn: account.isSignedIn, wishlist: account.wishlist || [] });
}
