import { getRoleContext } from '../../../lib/roles';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { SecurityError, getSecuritySwitchView, getSecurityPage, getAiSecurityPage, setSecuritySwitch, setChecklistTick } from '../../../lib/securityPage';

// Admin → Security and AI security (2026-11-05; lib/securityPage.js).
// Full admins only, the website and the app's Admin tab alike.
//   GET                → { switches } (what the app's Admin tab needs)
//   GET ?page=security → the Security page's data
//   GET ?page=ai       → the AI security page's data
//   POST { field, value }        → flip a switch; answers { switches }
//   POST { checklist, value }    → tick an item; answers { checklist }
// A switch the database can't hold yet answers 503 with the migration
// named (code migration-119 / migration-115); a switch a Vercel variable
// is holding, or the two-step requirement asked for from an account
// without two-step, answers 409 with the reason.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'private, no-store');
  const rc = await getRoleContext(req);
  if (!rc.isAdmin) return res.status(403).json({ error: 'Admin access required.' });

  try {
    if (req.method === 'GET') {
      const page = req.query.page;
      if (page === 'security') return res.status(200).json(await getSecurityPage(rc));
      if (page === 'ai') return res.status(200).json(await getAiSecurityPage());
      return res.status(200).json({ switches: await getSecuritySwitchView() });
    }
    if (req.method === 'POST') {
      if (!(await checkRateLimit(`admin-security:${rc.userId}`, 60, 3600))) {
        return res.status(429).json({ error: 'That’s a lot of switching. Try again in a while.' });
      }
      const body = req.body || {};
      if (typeof body.checklist === 'string') {
        const checklist = await setChecklistTick({ key: body.checklist, value: body.value, rc });
        return res.status(200).json({ checklist });
      }
      const switches = await setSecuritySwitch({ field: body.field, value: body.value, rc });
      return res.status(200).json({ switches });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof SecurityError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return sendError(res, err, 'admin/security');
  }
}
