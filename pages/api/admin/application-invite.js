import { requireCapability } from '../../../lib/adminAuth';
import { recordAudit } from '../../../lib/auditLog';
import { sendEmail } from '../../../lib/notify';
import { checkRateLimit } from '../../../lib/rateLimit';
import { applicationEmails } from '../../../lib/creatorApplications';

// /admin/applications → "Invite to apply": emails someone the /apply link.
//   POST { email, name?, note? }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const roleContext = await requireCapability(req, res, 'manage_applications');
  if (!roleContext) return;
  const { userId, email: adminEmail } = roleContext;

  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  const note = String(body.note || '').trim().slice(0, 1000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return res.status(400).json({ error: 'That doesn’t look like an email address.' });
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email isn’t set up on this server (RESEND_API_KEY), so nothing was sent. Copy the apply link instead.' });
  }
  // Plenty for real outreach, not enough to turn the site into a mailer.
  if (!(await checkRateLimit(`application-invite:${userId}`, 50, 86400))) {
    return res.status(429).json({ error: 'That’s 50 invites today. Try again tomorrow.' });
  }

  const mail = applicationEmails.invite({ name, note });
  const result = await sendEmail({ to: email, ...mail });
  if (!result || !result.sent) {
    return res.status(502).json({ error: `The email service didn’t accept it${result && result.reason ? `: ${result.reason}` : '. Check the address and try again.'}` });
  }
  await recordAudit({ adminId: userId, adminEmail, action: 'application_invite_sent', targetType: 'application', details: `Invited ${email}${name ? ` (${name})` : ''} to apply` });
  return res.status(200).json({ ok: true, email });
}
