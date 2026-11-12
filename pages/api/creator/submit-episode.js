import { getRoleContext } from '../../../lib/roles';
import { checkRateLimit, rateLimitKeyForRequest } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';
import { applyCors } from '../../../lib/cors';
import { submitDraft, ShowError } from '../../../lib/showPage';
import { wellFormedBody } from '../../../lib/wellFormed';

// Sends a title in for review (Creator Studio's three-step submit, the
// app's submit screen). Everything about the title — the checks, its place
// in a show, the show's defaults, "+ New show", the write — is
// submitDraft in lib/showPage.js (the series revamp, 2026-11-02), shared
// with the show page's "Send N for review"; this route checks who is
// asking and how often.

// Poster/thumbnail arrive as base64 data URLs in the JSON body (see
// pages/creator.js) rather than a real multipart upload — simplest thing
// that works given how small these files are, but it does mean the
// default 1MB Next.js API body limit has to grow to fit two images plus
// the video's TUS uid (which is tiny). 10MB comfortably covers a poster
// and thumbnail even before compression.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  // A lone surrogate in any text would make Postgres refuse the save
  // (a 500): every string in the body is made well formed first.
  wellFormedBody(req);
  // The app's submit screen calls this with a Bearer token.
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const allowed = await checkRateLimit(rateLimitKeyForRequest(req, 'creator-submit'), 20, 3600)
    && await checkRateLimit(`creator-submit:${userId}`, 20, 3600);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions — please wait a bit and try again.' });
  }

  try {
    const result = await submitDraft(req.body || {}, { userId, email, isAdmin });
    return res.status(200).json(result);
  } catch (err) {
    // A taken episode number answers with its holder and the next free
    // number, so the page can offer "Use E4 | Swap"; a show that takes
    // nothing new says so with code 'show-closed'.
    if (err instanceof ShowError && err.extra) return res.status(err.status).json({ error: err.message, ...err.extra });
    return sendError(res, err, 'creator/submit-episode', 'Could not submit the title.', { plainStatus: 400 });
  }
}
