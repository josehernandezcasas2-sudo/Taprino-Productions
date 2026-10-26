import { checkRateLimit, firstInWindow, rateLimitKeyForRequest } from '../../lib/rateLimit';

// Where browsers send what the Report-Only content policy (next.config.js)
// would have blocked (safety batch, 2026-10-26). Nothing is stored: each
// distinct directive + blocked host is logged once an hour, so the Vercel
// logs show the list of things the policy still needs before it can be
// switched to enforcing, without a flood. Takes both report formats
// (application/csp-report and the Reporting API's reports+json).
export const config = { api: { bodyParser: false } };

async function readBody(req, max = 16 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) return null;
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function hostOf(uri) {
  if (!uri) return '(none)';
  if (/^(inline|eval|data|blob|self)$/i.test(uri)) return uri.toLowerCase();
  try {
    return new URL(uri).host || uri.slice(0, 40);
  } catch (err) {
    return String(uri).slice(0, 40);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!(await checkRateLimit(rateLimitKeyForRequest(req, 'csp-report'), 30, 60))) return res.status(204).end();
  const text = await readBody(req);
  if (!text) return res.status(204).end();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return res.status(204).end();
  }
  const reports = Array.isArray(parsed) ? parsed.map((r) => r && r.body).filter(Boolean) : [parsed && parsed['csp-report']].filter(Boolean);
  for (const r of reports.slice(0, 10)) {
    const directive = String(r.effectiveDirective || r['effective-directive'] || r.violatedDirective || r['violated-directive'] || '?').split(' ')[0].slice(0, 40);
    const blocked = hostOf(r.blockedURL || r['blocked-uri']);
    const page = (() => { try { return new URL(r.documentURL || r['document-uri']).pathname.slice(0, 80); } catch (err) { return '?'; } })();
    if (await firstInWindow(`csp-seen:${directive}:${blocked}`, 3600)) {
      console.warn(`CSP report-only: ${directive} would block ${blocked} (on ${page})`);
    }
  }
  return res.status(204).end();
}
