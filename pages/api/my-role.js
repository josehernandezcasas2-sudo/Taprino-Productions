import { getRoleContext } from '../../lib/roles';

// Self-fetched by MobileTabBar so it can gate "My Work" to creators/admins
// without requiring every single page that renders <MobileTabBar /> to
// start passing role props down to it. This is genuinely per-user data
// (unlike HeaderNav's shop-settings fetch, which is the same for
// everyone) — never cache this response, and never expose anything here
// beyond the three booleans a nav actually needs to decide what to show.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { userId, isAdmin, isCreator, isContentScheduler, canAccessAdmin } = await getRoleContext(req);
  return res.status(200).json({
    isSignedIn: !!userId,
    isCreator: !!isCreator,
    isAdmin: !!isAdmin,
    isContentScheduler: !!isContentScheduler,
    // Sub-admins too — HeaderNav shows the Admin Portal link on this.
    canAccessAdmin: !!canAccessAdmin
  });
}
