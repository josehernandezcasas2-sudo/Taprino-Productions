import { getAuth } from '@clerk/nextjs/server';
import { uploadHeadshot } from '../../../lib/crewCards';
import { applyCors } from '../../../lib/cors';
import { checkRateLimit } from '../../../lib/rateLimit';

// One headshot for a performer card (migration 106): POST { base64,
// fileName } → { url }. The card save then references the URL. The
// browser/app downsizes first (max 1600px JPEG).
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
  // The card keeps six; a day's worth of tries is plenty (security round,
  // 2026-10-26: unsaved uploads stay in public storage).
  if (!(await checkRateLimit(`headshot-day:${userId}`, 40, 86400))) return res.status(429).json({ error: 'That’s a lot of headshots for one day — try again tomorrow.' });
  try {
    const { base64, fileName } = req.body || {};
    return res.status(200).json(await uploadHeadshot(userId, { base64, fileName }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(400).json({ error: err.message });
  }
}
