// Two-step sign-in for the team (safety batch, 2026-10-26). An admin or
// sub-admin account is the key to people's money and private data, so
// with the requirement on — Admin → Security → "Require two-step for the
// team" (site_settings.admin_require_2fa, migration 119, since
// 2026-11-05) or ADMIN_REQUIRE_2FA=on in Vercel — an admin role only counts once the
// account has two-step verification turned on in Clerk (Account →
// Security → Manage). Without the switch nothing is enforced and the
// admin pages show a reminder instead. Pure; no imports.
//
// The switch refuses to turn on from an account without two-step
// (lib/securityRules.js switchRefusal), so it can't lock its own admin
// out. If the Clerk instance's multi-factor setting is ever turned off
// while it is on, nobody can meet it: run
//   update site_settings set admin_require_2fa = false where id = 1;
// in the Supabase SQL Editor (and blank ADMIN_REQUIRE_2FA if set).

export function twoFactorRequired(env = process.env) {
  return /^(on|true|1|yes)$/i.test(String((env && env.ADMIN_REQUIRE_2FA) || '').trim());
}

// { twoFactor, blocked }: blocked = the account holds a team role the
// requirement says it can't use yet. `required` is what
// lib/securitySwitches.js says is in force (switch or variable); without
// it only the variable counts.
export function adminTwoFactorState(user, wantsTeamRole, env = process.env, required) {
  const twoFactor = Boolean(user && user.twoFactorEnabled);
  const on = typeof required === 'boolean' ? required : twoFactorRequired(env);
  return { twoFactor, blocked: Boolean(wantsTeamRole) && on && !twoFactor };
}
