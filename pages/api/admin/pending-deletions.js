import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();
  const [episodesResult, seriesResult] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, title, artist, deletion_reason, deletion_requested_at')
      .eq('deletion_requested', true)
      .order('deletion_requested_at', { ascending: true }),
    supabase
      .from('series')
      .select('id, name, deletion_reason, deletion_requested_at')
      .eq('deletion_requested', true)
      .order('deletion_requested_at', { ascending: true })
  ]);

  if (episodesResult.error || seriesResult.error) {
    console.error('pending-deletions error:', (episodesResult.error || seriesResult.error).message);
    return res.status(500).json({ error: 'Could not load pending deletions.' });
  }

  return res.status(200).json({
    episodes: (episodesResult.data || []).map((e) => ({
      id: e.id,
      title: e.title,
      artist: e.artist,
      reason: e.deletion_reason,
      requestedAt: e.deletion_requested_at
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      name: s.name,
      reason: s.deletion_reason,
      requestedAt: s.deletion_requested_at
    }))
  });
}
