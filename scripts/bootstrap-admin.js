// Bootstraps the very first admin account. Run this once, after you've
// signed up for a real account on the live site with your own email:
//
//   node scripts/bootstrap-admin.js you@example.com --live
//
// Why this has to be a script and not a button in the app: granting admin
// access requires already being an admin (see lib/roles.js) — there's a
// chicken-and-egg problem for the very first one. Every admin or creator
// role after this first one should go through the admin portal instead,
// once it exists — this script is only for getting the first admin in.
//
// Two guards (security round 2, 2026-10-28): a live Clerk key needs
// --live on the command line, so a mistyped run against the production
// instance does nothing; and the address has to be a verified one held by
// exactly one account (the rule lib/roles.js's findUserByEmail follows),
// so an unverified address someone else typed can't be made an admin.

require('dotenv').config({ path: '.env.local' });
const { createClerkClient } = require('@clerk/backend');

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const email = args.find((a) => !a.startsWith('--'));
  if (!email) {
    console.error('Usage: node scripts/bootstrap-admin.js you@example.com [--live]');
    process.exit(1);
  }
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    console.error('Missing CLERK_SECRET_KEY in .env.local.');
    process.exit(1);
  }
  if (key.startsWith('sk_live_') && !live) {
    console.error('CLERK_SECRET_KEY is a live key. Re-run with --live if you really mean the production instance.');
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey: key });
  const { data } = await clerk.users.getUserList({ emailAddress: [email] });
  const wanted = email.trim().toLowerCase();
  const verifiedHolders = (data || []).filter((u) => (u.emailAddresses || []).some((a) => a.emailAddress && a.emailAddress.toLowerCase() === wanted && a.verification && a.verification.status === 'verified'));

  if (verifiedHolders.length === 0) {
    console.error(`No Clerk account holds ${email} as a verified address. Sign up on the live site with this email, confirm it, then re-run this script.`);
    process.exit(1);
  }
  if (verifiedHolders.length > 1) {
    console.error(`${verifiedHolders.length} accounts hold ${email} as a verified address — grant the role from the admin portal instead.`);
    process.exit(1);
  }

  const user = verifiedHolders[0];
  await clerk.users.updateUserMetadata(user.id, {
    publicMetadata: { ...user.publicMetadata, role: 'admin' }
  });

  console.log(`Done — ${email} is now an admin. Visit /admin on the site to confirm.`);
}

main();
