import { sendEmail } from './notify';
import { firstInWindow } from './rateLimit';
import { SITE } from './siteConfig';

// SERVER-ONLY. A short email to the studio when something security-
// relevant happens that a person should know about the same day (safety
// batch, 2026-10-26): someone's role or admin permissions changed, an
// admin turned something off, or webhook requests are failing their
// signature check. Goes to SECURITY_ALERT_EMAIL, else the contact
// address. `throttleKey` keeps a burst (a scripted run of forged webhook
// calls) to one email per window. Never throws: an alert that couldn't be
// sent must not undo the action it describes.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function securityAlert(subject, lines = [], { throttleKey = null, throttleSeconds = 3600 } = {}) {
  try {
    if (throttleKey && !(await firstInWindow(`security-alert:${throttleKey}`, throttleSeconds))) return { throttled: true };
    const to = process.env.SECURITY_ALERT_EMAIL || SITE.contactEmail;
    const when = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const body = lines.filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join('');
    return await sendEmail({
      to,
      subject: `[${SITE.name} security] ${subject}`,
      html: `<p><b>${esc(subject)}</b> · ${esc(when)} UTC</p>${body ? `<ul>${body}</ul>` : ''}<p style="color:#888;font-size:12px">If this was you or someone on the team, nothing to do. If not, check the admin audit log and the account named above.</p>`
    });
  } catch (err) {
    console.error('securityAlert:', err.message);
    return { sent: false };
  }
}
