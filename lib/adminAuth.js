import { getRoleContext } from './roles';
import { hasCapability } from './capabilities';

// Standard guard for admin API routes. Writes the 403 response itself and
// returns null when unauthorized, so every route follows the same
// two-line pattern:
//
//   const roleContext = await requireCapability(req, res, 'manage_schedule');
//   if (!roleContext) return;
//
// Full admins always pass, regardless of capability — this is the single
// place that logic lives, so no route can accidentally drift out of sync
// with lib/capabilities.js's hasCapability().
export async function requireCapability(req, res, capability) {
  const roleContext = await getRoleContext(req);
  if (!hasCapability(roleContext, capability)) {
    res.status(403).json({ error: 'You do not have permission to do this.' });
    return null;
  }
  return roleContext;
}

// For routes with no single obvious capability (e.g. stats/library reads
// that any admin-area account should see) — just requires being in the
// admin area at all, full admin or sub-admin alike.
export async function requireAdminArea(req, res) {
  const roleContext = await getRoleContext(req);
  if (!roleContext.canAccessAdmin) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return roleContext;
}
