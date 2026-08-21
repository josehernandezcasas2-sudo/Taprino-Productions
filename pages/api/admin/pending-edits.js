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
      .select('id, title, description, pending_title, pending_description')
      .or('pending_title.not.is.null,pending_description.not.is.null'),
    supabase
      .from('series')
      .select('id, name, description, pending_name, pending_description')
      .or('pending_name.not.is.null,pending_description.not.is.null')
  ]);

  if (episodesResult.error || seriesResult.error) {
    console.error('pending-edits error:', (episodesResult.error || seriesResult.error).message);
    return res.status(500).json({ error: 'Could not load pending edit requests.' });
  }

  return res.status(200).json({
    episodes: (episodesResult.data || []).map((e) => ({
      id: e.id,
      currentTitle: e.title,
      currentDescription: e.description,
      pendingTitle: e.pending_title,
      pendingDescription: e.pending_description
    })),
    series: (seriesResult.data || []).map((s) => ({
      id: s.id,
      currentName: s.name,
      currentDescription: s.description,
      pendingName: s.pending_name,
      pendingDescription: s.pending_description
    }))
  });
}
