import { requireCapability } from '../../../lib/adminAuth';
import { createDocumentUploadUrl } from '../../../lib/universityDocs';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';

// Mints a one-time Supabase Storage upload URL for a Film University PDF
// (a document lesson, a template, a worksheet). The browser PUTs the file
// there directly; the resulting public URL is what gets saved on the
// lesson. See lib/universityDocs.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const roleContext = await requireCapability(req, res, 'manage_university');
  if (!roleContext) return;

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'admin-university-doc-upload-url'), 60, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many upload requests — please wait a bit and try again.' });

  const { fileName, fileSize } = req.body || {};
  try {
    const result = await createDocumentUploadUrl({ fileName, fileSize: Number(fileSize) });
    return res.status(200).json(result);
  } catch (err) {
    console.error('university-document-upload-url error:', err.message);
    return res.status(400).json({ error: err.message || 'Could not create an upload link.' });
  }
}
