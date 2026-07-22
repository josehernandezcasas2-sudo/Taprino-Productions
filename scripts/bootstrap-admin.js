// Bootstraps the very first admin account. Run this once, after you've
// signed up for a real account on the live site with your own email:
//
//   node scripts/bootstrap-admin.js you@example.com
//
// Why this has to be a script and not a button in the app: granting admin
// access requires already being an admin (see lib/roles.js) — there's a
// chicken-and-egg problem for the very first one. Every admin or creator
// role after this first one should go through the admin portal instead,
// once it exists — this script is only for getting the first admin in.

require('dotenv').config({ path: '.env.local' });
const { createClerkClient } = require('@clerk/backend');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/bootstrap-admin.js you@example.com');
    process.exit(1);
  }
  if (!process.env.CLERK_SECRET_KEY) {
    console.error('Missing CLERK_SECRET_KEY in .env.local.');
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const { data } = await clerk.users.getUserList({ emailAddress: [email] });

  if (data.length === 0) {
    console.error(`No Clerk account found for ${email}. Sign up on the live site with this email first, then re-run this script.`);
    process.exit(1);
  }

  const user = data[0];
  await clerk.users.updateUserMetadata(user.id, {
    publicMetadata: { ...user.publicMetadata, role: 'admin' }
  });

  console.log(`Done — ${email} is now an admin. Visit /admin on the site to confirm.`);
}

main();
