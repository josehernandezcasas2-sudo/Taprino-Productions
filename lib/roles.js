import { clerkClient, getAuth } from '@clerk/nextjs/server';

// Roles live in Clerk's publicMetadata.role — same field already used for
// the Stripe customer link (see lib/clerkStripeLink.js). Values: 'admin',
// 'creator', or absent (a regular signed-in viewer, the default for
// everyone). This is server-write-only from Clerk's side — a signed-in
// user cannot grant themselves a role by any means from the browser, only
// an admin (via the admin portal) or you directly (via Clerk's own
// dashboard) can set it.
export async function getUserRole(userId) {
  if (!userId) return null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return (user.publicMetadata && user.publicMetadata.role) || null;
}

// For getServerSideProps — returns { userId, role, isAdmin, isCreator }.
// Use this at the top of any admin or creator page.
export async function getRoleContext(req) {
  const { userId } = getAuth(req);
  const role = await getUserRole(userId);
  return {
    userId,
    role,
    isAdmin: role === 'admin',
    isCreator: role === 'creator' || role === 'admin' // admins can do anything a creator can
  };
}

// SECURITY: only ever call this from an already-admin-verified code path —
// this function itself does not check whether the caller is an admin, it
// just performs the write. The API route calling this is responsible for
// confirming getRoleContext(req).isAdmin === true first.
export async function setUserRole(targetUserId, role) {
  const client = await clerkClient();
  const user = await client.users.getUser(targetUserId);
  await client.users.updateUserMetadata(targetUserId, {
    publicMetadata: { ...user.publicMetadata, role }
  });
}

// Looks up a Clerk user by email — used by the admin "grant creator access"
// flow, where the admin only knows the person's email, not their user id.
export async function findUserByEmail(email) {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email] });
  return data.length > 0 ? data[0] : null;
}

// Everyone currently holding 'creator' or 'admin' in Clerk — for the admin
// roster view. Clerk doesn't offer a server-side filter on publicMetadata
// fields, so this pages through the full user list and filters here; fine
// at the scale of a small trusted roster, worth revisiting with a real
// index (or caching) if this ever grows into the hundreds of users.
export async function listCreatorsAndAdmins() {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 500 });
  return data
    .filter((u) => u.publicMetadata && (u.publicMetadata.role === 'creator' || u.publicMetadata.role === 'admin'))
    .map((u) => {
      const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
      return {
        id: u.id,
        email: primary ? primary.emailAddress : (u.emailAddresses[0] ? u.emailAddresses[0].emailAddress : null),
        role: u.publicMetadata.role,
        joinedAt: u.createdAt
      };
    });
}
