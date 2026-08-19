import { clerkClient, getAuth } from '@clerk/nextjs/server';

// Roles live in Clerk's publicMetadata.role — same field already used for
// the Stripe customer link (see lib/clerkStripeLink.js). Values: 'admin',
// 'sub_admin', 'creator', or absent (a regular signed-in viewer, the
// default for everyone). This is server-write-only from Clerk's side — a
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
const SYSTEM_ADMIN_EMAIL = (process.env.SYSTEM_ADMIN_EMAIL || '').toLowerCase().trim();

function isSystemAdminEmail(email) {
  return Boolean(SYSTEM_ADMIN_EMAIL) && Boolean(email) && email.toLowerCase() === SYSTEM_ADMIN_EMAIL;
}

export async function getUserRole(userId) {
  if (!userId) return null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return (user.publicMetadata && user.publicMetadata.role) || null;
}

// For getServerSideProps and API routes — returns { userId, role, email,
// permissions, isAdmin, isSubAdmin, isCreator, canAccessAdmin }.
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
      isCreator: false,
      canAccessAdmin: false
    };
  }
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata || {};
  const role = meta.role || null;
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  const email = primary ? primary.emailAddress : (user.emailAddresses[0] ? user.emailAddresses[0].emailAddress : null);

  const isAdmin = role === 'admin' || isSystemAdminEmail(email);
  const isSubAdmin = !isAdmin && role === 'sub_admin';
  const permissions = Array.isArray(meta.permissions) ? meta.permissions : [];

  return {
    userId,
    role,
    email,
    permissions,
    isAdmin,
    isSubAdmin,
    isCreator: role === 'creator' || isAdmin, // admins can do anything a creator can
    canAccessAdmin: isAdmin || isSubAdmin
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
}

// Looks up a Clerk user by email — used by the admin "grant access" flow,
// where the admin only knows the person's email, not their user id.
export async function findUserByEmail(email) {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email] });
  return data.length > 0 ? data[0] : null;
}

// Everyone currently holding 'creator', 'sub_admin', or 'admin' in Clerk —
// for the admin roster / team management view. Clerk doesn't offer a
// server-side filter on publicMetadata fields, so this pages through the
// full user list and filters here; fine at the scale of a small trusted
// roster, worth revisiting with a real index (or caching) if this ever
// grows into the hundreds of users.
export async function listCreatorsAndAdmins() {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 500 });
  return data
    .filter((u) => u.publicMetadata && ['creator', 'sub_admin', 'admin'].includes(u.publicMetadata.role))
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
