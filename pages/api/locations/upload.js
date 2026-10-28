import { getAuth } from '@clerk/nextjs/server';
import { uploadListingImage } from '../../../lib/locations';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sendError } from '../../../lib/apiErrors';

// One image at a time (the form uploads each photo as it's picked, so no
// request carries the whole gallery): a listing photo, or the proof an
// admin checks before the place goes public.
//   POST { base64, fileName, purpose: 'photo' | 'proof' } → { url }
// The browser downsizes photos before sending (max 1600px JPEG), which
// keeps each well under Vercel's request limit.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  // A listing keeps twelve photos and a proof; a day's worth of tries
  // across a host's places (security round, 2026-10-26).
  if (!(await checkRateLimit(`location-upload-day:${userId}`, 120, 86400))) return res.status(429).json({ error: 'That’s a lot of photos for one day — try again tomorrow.' });
  try {
    const { base64, fileName, purpose } = req.body || {};
    return res.status(200).json(await uploadListingImage(userId, { base64, fileName, purpose }));
  } catch (err) {
    return sendError(res, err, 'locations/upload', 'Could not upload the photo.', { plainStatus: 400 });
  }
}
