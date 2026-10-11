import { getAuth } from '@clerk/nextjs/server';
import { getSupabase } from '../../../lib/supabase';

// The signed-in person's Pitch Room projects and series, for the
// "Project (optional)" picker when posting a call (the app; the website
// loads the same list server-side).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  const supabase = getSupabase();
  const [pitches, series] = await Promise.all([
    supabase.from('pitches').select('id, title').eq('created_by', userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('series').select('id, name').eq('creator_id', userId).order('created_at', { ascending: false }).limit(50)
  ]);
  return res.status(200).json({
    projects: [
      ...(pitches.data || []).map((p) => ({ value: `pitch:${p.id}`, label: `Pitch Room · ${p.title}` })),
      ...(series.data || []).map((s) => ({ value: `series:${s.id}`, label: `Series · ${s.name}` }))
    ]
  });
}
