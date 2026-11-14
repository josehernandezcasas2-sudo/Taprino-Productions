import { getRoleContext } from '../../../lib/roles';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { DownloadError, getDownloadsAdmin, setDownloadsSwitch } from '../../../lib/downloads';
import { MIGRATION_123_MSG, SWITCH_CHANGES_PER_HOUR } from '../../../lib/downloadSiteRules';

// Admin → Downloads (Jose, 2026-11-14: "a section in admin to toggle this
// feature on and off, with an eventual lock on. That only admin or me can
// do. Sub admin accounts should not be able to unlock it or change it").
// FULL ADMINS ONLY: `rc.isAdmin`, never a capability — a sub-admin is
// refused whatever permissions they hold, and so is everyone else.
//   GET  → { switch: { available, enabled, locked, changedAt, changedBy,
//           lockedAt, lockedBy }, numbers: { phones, copies, titlesOff },
//           titlesOff: [{ id, title }] }
//   POST { enabled }                           flip the switch (409 { code: 'locked' } while locked)
//   POST { locked: true }                      lock it
//   POST { locked: false, confirm: 'UNLOCK' }  unlock it (400 { code: 'confirm' } without the word)
//   → the same answer as GET. Every change is one audit line
//   (downloads_switch) and a security alert mail; 30 changes an hour.
// Before migration 123 both answer 503 { code: 'migration-123' }.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'private, no-store');
  const rc = await getRoleContext(req);
  if (rc.isAdmin !== true) return res.status(403).json({ error: 'Admin access required.' });

  try {
    if (req.method === 'GET') {
      const view = await getDownloadsAdmin();
      if (!view.switch.available) {
        return view.switch.readFailed
          ? res.status(503).json({ error: 'The settings can’t be read right now. Try again in a minute.', code: 'unavailable' })
          : res.status(503).json({ error: MIGRATION_123_MSG, code: 'migration-123' });
      }
      return res.status(200).json(view);
    }
    if (req.method === 'POST') {
      if (!(await checkRateLimit(`admin-downloads:${rc.userId}`, SWITCH_CHANGES_PER_HOUR, 3600))) {
        return res.status(429).json({ error: 'That’s a lot of switching. Try again in a while.' });
      }
      return res.status(200).json(await setDownloadsSwitch({ body: req.body, rc }));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof DownloadError) return res.status(err.status).json({ error: err.message, ...err.extra });
    return sendError(res, err, 'admin/downloads');
  }
}
