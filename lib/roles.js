import { clerkClient, getAuth } from '@clerk/nextjs/server';
import { getClerkUser } from './clerkUser';
import { securityAlert } from './securityAlerts';
import { adminTwoFactorState } from './adminTwoFactor';

// Roles live in Clerk's publicMetadata.role — same field already used for
// the Stripe customer link (see lib/clerkStripeLink.js). Values: 'admin',
// 'sub_admin', 'content_scheduler', 'creator', or absent (a regular
// signed-in viewer, the default for everyone). A content_scheduler can do
// everything a creator can, plus schedule the channels an admin assigned
// them to (channel_schedulers table, see lib/channelAccess.js). This is server-write-only from Clerk's side — a
// signed-in user cannot grant themselves a role by any means from the
// browser, only an admin (via the admin portal) or you directly (via
// Clerk's own dashboard) can set it.
//
// 'sub_admin' accounts additionally carry publicMetadata.permissions — an
// array of capability keys from lib/capabilities.js, set by an admin via
// the toggle panel at /admin/team. A sub-admin with an empty/missing
// permissions array can sign in and reach the admin area, but sees and can
// do nothing until an admin flips at least one switch on for them.
//
// SYSTEM_ADMIN_EMAIL (optional): if set in the environment, that one email
// is always treated as admin regardless of what Clerk's metadata says —
// a safety net so a single guaranteed login (e.g. info@studiotapa.com)
// can never accidentally lose admin access the way a personal account's
// role got wiped before. Leave the env var unset and this has zero effect.
export const TEAM_ROLES = ['creator', 'content_scheduler', 'sub_admin', 'admin'];

const SYSTEM_ADMIN_EMAIL = (process.env.SYSTEM_ADMIN_EMAIL || '').toLowerCase().trim();

function isSystemAdminEmail(email) {
  return Boolean(SYSTEM_ADMIN_EMAIL) && Boolean(email) && email.toLowerCase() === SYSTEM_ADMIN_EMAIL;
}

export async function getUserRole(userId) {
  if (!userId) return null;
  const client = await clerkClient();
  try {
    const user = await client.users.getUser(userId);
    return (user.publicMetadata && user.publicMetadata.role) || null;
  } catch (err) {
    // An id Clerk has never heard of (a mistyped /profile/user_... URL)
    // used to throw here and 500 the whole page; it's just "no role."
    if (err && (err.status === 404 || /not found/i.test(err.message || ''))) return null;
    throw err;
  }
}

// For getServerSideProps and API routes — returns { userId, role, email,
// permissions, isAdmin, isSubAdmin, isContentScheduler, isCreator,
// canAccessAdmin }.
//
//   isAdmin        — full admin. Bypasses every capability check.
//   isSubAdmin     — limited admin. Can reach /admin pages but only sees/
//                    does what hasCapability() allows for their permissions.
//   canAccessAdmin — isAdmin || isSubAdmin. Use this (not isAdmin) as the
//                    page-level gate on admin pages, so sub-admins aren't
//                    redirected out entirely — the page itself then decides
//                    what to render/allow based on individual capabilities.
export async function getRoleContext(req) {
  const { userId } = getAuth(req);
  if (!userId) {
    return {
      userId: null,
      role: null,
      email: null,
      permissions: [],
      isAdmin: false,
      isSubAdmin: false,
      isContentScheduler: false,
      isCreator: false,
      canAccessAdmin: false
    };
  }
  const user = await getClerkUser(req, userId); // shared with getAccountContext on the same request
  const meta = user.publicMetadata || {};
  const role = meta.role || null;
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  const email = primary ? primary.emailAddress : (user.emailAddresses[0] ? user.emailAddresses[0].emailAddress : null);

  // The SYSTEM_ADMIN_EMAIL safety net only trusts the account's primary
  // address, and only once Clerk has verified it: the fallback to the
  // first address above (or an unverified one) must never make an admin.
  const verifiedPrimary = primary && primary.verification && primary.verification.status === 'verified' ? primary.emailAddress : null;
  const systemAdmin = isSystemAdminEmail(verifiedPrimary);
  // Two-step for the team (lib/adminTwoFactor.js): with ADMIN_REQUIRE_2FA
  // on, an admin role without two-step counts for nothing on any route.
  const twoStep = adminTwoFactorState(user, role === 'admin' || role === 'sub_admin' || systemAdmin);
  const isAdmin = (role === 'admin' || systemAdmin) && !twoStep.blocked;
  const isSubAdmin = !isAdmin && role === 'sub_admin' && !twoStep.blocked;
  const permissions = Array.isArray(meta.permissions) ? meta.permissions : [];

  return {
    userId,
    role,
    email,
    permissions,
    isAdmin,
    isSubAdmin,
    isContentScheduler: role === 'content_scheduler',
    // admins and content schedulers can do anything a creator can
    isCreator: role === 'creator' || role === 'content_scheduler' || role === 'admin' || systemAdmin,
    canAccessAdmin: isAdmin || isSubAdmin,
    twoFactorEnabled: twoStep.twoFactor,
    adminNeedsTwoFactor: twoStep.blocked
  };
}

// SECURITY: only ever call this from an already-admin-verified code path —
// this function itself does not check whether the caller is an admin, it
// just performs the write. The API route calling this is responsible for
// confirming getRoleContext(req).isAdmin === true first.
export async function setUserRole(targetUserId, role) {
  const client = await clerkClient();
  const user = await client.users.getUser(targetUserId);
  const nextMeta = { ...user.publicMetadata, role };
  // Switching away from sub_admin (or clearing the role entirely) drops any
  // leftover permissions array too — otherwise a later re-grant to
  // sub_admin would silently resurrect whatever they could do last time,
  // which is surprising and not what "revoke then re-grant" should mean.
  if (role !== 'sub_admin') {
    delete nextMeta.permissions;
  }
  await client.users.updateUserMetadata(targetUserId, { publicMetadata: nextMeta });
  // Every role change is mailed to the studio (safety batch, 2026-10-26):
  // the audit log says who did it; this makes sure someone sees it today.
  await securityAlert(role ? `Role changed to ${role}` : 'Role removed', [
    `Account: ${describeUser(user)}`,
    `Was: ${(user.publicMetadata && user.publicMetadata.role) || 'no role'}`,
    `Now: ${role || 'no role'}`
  ]);
}

function describeUser(user) {
  const primary = (user.emailAddresses || []).find((e) => e.id === user.primaryEmailAddressId);
  return `${primary ? primary.emailAddress : 'no email'} (${user.id})`;
}

// SECURITY: same rule as setUserRole — caller must already have confirmed
// isAdmin. Only meaningful for sub_admin accounts; setting permissions on
// a full admin or a plain viewer is a no-op in practice since hasCapability
// only consults this array for role === 'sub_admin'.
export async function setUserPermissions(targetUserId, permissions) {
  const client = await clerkClient();
  const user = await client.users.getUser(targetUserId);
  await client.users.updateUserMetadata(targetUserId, {
    publicMetadata: { ...user.publicMetadata, permissions: Array.isArray(permissions) ? permissions : [] }
  });
  await securityAlert('Admin permissions changed', [
    `Account: ${describeUser(user)}`,
    `Now: ${(Array.isArray(permissions) && permissions.length) ? permissions.join(', ') : 'none'}`
  ]);
}

// Looks up a Clerk user by email — used by the admin "grant access" flow,
// where the admin only knows the person's email, not their user id.
// Only an account that has *verified* that address counts, and only when
// exactly one does (security round, 2026-10-26): roles and series
// ownership are granted this way, so an unverified copy of someone's
// address on another account must never receive them.
export async function findUserByEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [wanted] });
  const verified = (data || []).filter((u) => (u.emailAddresses || []).some((a) => String(a.emailAddress || '').toLowerCase() === wanted && a.verification && a.verification.status === 'verified'));
  return verified.length === 1 ? verified[0] : null;
}

// Everyone currently holding 'creator', 'content_scheduler', 'sub_admin',
// or 'admin' in Clerk —
// for the admin roster / team management view. Clerk doesn't offer a
// server-side filter on publicMetadata fields, so this pages through the
// full user list and filters here; fine at the scale of a small trusted
// roster, worth revisiting with a real index (or caching) if this ever
// grows into the hundreds of users.
export async function listCreatorsAndAdmins() {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 500 });
  return data
    .filter((u) => u.publicMetadata && TEAM_ROLES.includes(u.publicMetadata.role))
    .map((u) => {
      const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
      return {
        id: u.id,
        email: primary ? primary.emailAddress : (u.emailAddresses[0] ? u.emailAddresses[0].emailAddress : null),
        role: u.publicMetadata.role,
        permissions: Array.isArray(u.publicMetadata.permissions) ? u.publicMetadata.permissions : [],
        joinedAt: u.createdAt
      };
    });
}
