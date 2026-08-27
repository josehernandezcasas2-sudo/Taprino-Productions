import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isAdmin } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const { seriesId, name, description } = req.body || {};
  if (!seriesId || (!name && !description)) {
    return res.status(400).json({ error: 'seriesId and at least one of name/description are required.' });
  }

  const supabase = getSupabase();
  const { data: series, error: fetchError } = await supabase
    .from('series')
    .select('name, description, creator_id')
    .eq('id', seriesId)
    .maybeSingle();
  if (fetchError || !series) {
    return res.status(404).json({ error: 'Show not found.' });
  }

  // Series now has a direct creator_id (see migration 038) — check that
  // first since it's the real, authoritative link. Fall back to the old
  // indirect "do you have an episode in it" check for any series created
  // before that column existed and never got backfilled.
  if (!isAdmin && series.creator_id !== userId) {
    const { data: ownEpisode } = await supabase
      .from('episodes')
      .select('id')
      .eq('series_id', seriesId)
      .eq('submitted_by', userId)
      .limit(1)
      .maybeSingle();
    if (!ownEpisode) {
      return res.status(403).json({ error: 'You can only request edits on shows you have episodes in.' });
    }
  }

  const updates = {};
  if (name && name.trim() && name.trim() !== series.name) updates.pending_name = name.trim();
  if (description && description.trim() !== (series.description || '')) updates.pending_description = description.trim();

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing actually changed from the current name/description.' });
  }

  const { error } = await supabase.from('series').update(updates).eq('id', seriesId);
  if (error) {
    console.error('request-series-edit error:', error.message);
    return res.status(500).json({ error: 'Could not submit your edit request.' });
  }

  return res.status(200).json({ ok: true });
}
