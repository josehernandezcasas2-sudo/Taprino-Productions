import { getAuth } from '@clerk/nextjs/server';
import { uploadListingImage } from '../../../lib/locations';

// One image at a time (the form uploads each photo as it's picked, so no
// request carries the whole gallery): a listing photo, or the proof an
// admin checks before the place goes public.
//   POST { base64, fileName, purpose: 'photo' | 'proof' } → { url }
// The browser downsizes photos before sending (max 1600px JPEG), which
// keeps each well under Vercel's request limit.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  try {
    const { base64, fileName, purpose } = req.body || {};
    return res.status(200).json(await uploadListingImage(userId, { base64, fileName, purpose }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(400).json({ error: err.message });
  }
}
