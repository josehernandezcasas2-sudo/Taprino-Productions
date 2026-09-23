import { getAuth } from '@clerk/nextjs/server';
import { getAccountContext } from '../../../lib/accountContext';
import { sendEmail } from '../../../lib/notify';

// Deliberately a request, not an instant delete — deleting a signed-in
// user's row(s) directly from an API route triggered by that same user
// has no human review step and no chance to catch mistakes (wrong
// account, regret, a support case in progress). An admin actions the
// request by hand, same as any other account-affecting support ticket.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const account = await getAccountContext(req);

  const adminEmail = (process.env.SYSTEM_ADMIN_EMAIL || '').trim();
  if (!adminEmail) {
    console.error('request-deletion: SYSTEM_ADMIN_EMAIL is not set — nowhere to send this.');
    return res.status(500).json({ error: 'Account deletion requests aren’t available right now — please contact support directly.' });
  }

  await sendEmail({
    to: adminEmail,
    subject: `Account deletion request — ${account.email || userId}`,
    html: `<p>A user has requested their account be deleted.</p>
      <p><strong>Email:</strong> ${account.email || 'unknown'}<br>
      <strong>User ID:</strong> ${userId}<br>
      <strong>Requested at:</strong> ${new Date().toISOString()}</p>`
  });

  return res.status(200).json({ requested: true });
}
