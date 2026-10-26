// Two-step sign-in for the team (safety batch, 2026-10-26). An admin or
// sub-admin account is the key to people's money and private data, so
// with ADMIN_REQUIRE_2FA=on in Vercel an admin role only counts once the
// account has two-step verification turned on in Clerk (Account →
// Security → Manage). Without the switch nothing is enforced and the
// admin pages show a reminder instead. Pure; no imports.
//
// Turn the switch on only after two-step is enabled for the Clerk
// instance (Clerk dashboard → User & authentication → Multi-factor) and
// set up on your own account, or you lock yourself out of /admin until
// you blank the variable again.

export function twoFactorRequired(env = process.env) {
  return /^(on|true|1|yes)$/i.test(String((env && env.ADMIN_REQUIRE_2FA) || '').trim());
}

// { twoFactor, blocked }: blocked = the account holds a team role the
// switch says it can't use yet.
export function adminTwoFactorState(user, wantsTeamRole, env = process.env) {
  const twoFactor = Boolean(user && user.twoFactorEnabled);
  return { twoFactor, blocked: Boolean(wantsTeamRole) && twoFactorRequired(env) && !twoFactor };
}
