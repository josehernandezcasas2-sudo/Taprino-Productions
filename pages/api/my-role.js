import { getRoleContext } from '../../lib/roles';
import { getOwnProfile } from '../../lib/userProfiles';
import { getSuspensionFor } from '../../lib/suspensions';
import { applyCors } from '../../lib/cors';
import { accountTypesFromRow, readAccountTypes } from '../../lib/accountTypes';

// Self-fetched by MobileTabBar so it can gate "My Work" to creators/admins
// without requiring every single page that renders <MobileTabBar /> to
// start passing role props down to it. This is genuinely per-user data
// (unlike HeaderNav's shop-settings fetch, which is the same for
// everyone) — never cache this response, and never expose anything here
// beyond the three booleans a nav actually needs to decide what to show.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const { userId, isAdmin, isCreator, isContentScheduler, canAccessAdmin, permissions } = await getRoleContext(req);
  // The tab bar's "View profile" row needs the public URL, which is the
  // @handle when one is set. Same rule as HeaderNav's ownProfileHref.
  let profileHref = null;
  // Suspensions (migration 102): the app's gate reads this on sign-in
  // and when it comes to the foreground; null when nothing is in force.
  let suspended = null;
  // The tab bar's Account tab and the app's bottom bar draw the person's own
  // photo since the photo left the header (2026-11-18), with its focal point
  // and zoom like every avatar on the site; the ☰ menu's card has the name.
  let avatar = null;
  let displayName = null;
  // Account types (migration 126): the ☰ menu's you card shows them and
  // lets the person switch their main; null signed out or before 126.
  let accountTypes = null;
  if (userId) {
    const [profile, s] = await Promise.all([getOwnProfile(userId).catch(() => null), getSuspensionFor(userId)]);
    profileHref = `/profile/${(profile && profile.handle) || userId}`;
    suspended = s;
    if (profile && profile.avatar_url) {
      avatar = { url: profile.avatar_url, position: profile.avatar_position || null, zoom: profile.avatar_zoom ? Number(profile.avatar_zoom) : null };
    }
    displayName = profile && profile.display_name ? profile.display_name : null;
    // No profile in hand (no row yet, or the read failed): ask for the types
    // on their own, which tells a missing row from a database without 126
    // or a failed read (2026-11-20 review: those offered "+ Add a type").
    const t = profile ? accountTypesFromRow(profile) : await readAccountTypes(userId);
    accountTypes = t.available ? { types: t.types, main: t.main, asked: t.asked } : null;
  }
  return res.status(200).json({
    isSignedIn: !!userId,
    isCreator: !!isCreator,
    isAdmin: !!isAdmin,
    isContentScheduler: !!isContentScheduler,
    // Sub-admins too — HeaderNav shows the Admin Portal link on this.
    canAccessAdmin: !!canAccessAdmin,
    // A sub-admin's own capabilities: the ☰ menu's Admin side shows the
    // admin pages they can open (lib/siteMenuRules.js). Empty for everyone
    // else (a full admin opens every page).
    permissions: canAccessAdmin && !isAdmin && Array.isArray(permissions) ? permissions : [],
    profileHref,
    avatar,
    displayName,
    accountTypes,
    suspended
  });
}
