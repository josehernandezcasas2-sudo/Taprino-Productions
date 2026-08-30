import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// Mirrors the fields REQUIRED_FIELDS enforces in submit-episode.js, minus
// videoUid (the video itself isn't editable here — re-uploading a new cut
// is a separate feature, not this one) plus the series-specific fields.
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'contentType', 'seriesId', 'season', 'seriesOrder', 'rating', 'releaseYear'];
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, ...fields } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();

  // Ownership + pending-only check happens as part of the update's WHERE
  // clause below (not a separate read-then-write), which closes the gap
  // where someone else's episode gets approved in between a check and the
  // write — but we still need to know up front whether it *would* have
  // matched, to tell the creator why nothing changed.
  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, submitted_by, status, content_type')
    .eq('id', episodeId)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That submission does not belong to you.' });
  }
  if (existing.status !== 'pending') {
    return res.status(400).json({ error: 'Only submissions still pending review can be edited — this one has already been reviewed.' });
  }

  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    if (String(fields[f]).trim() === '' && f !== 'seriesId') continue; // allow clearing seriesId back out
    updates[f] = fields[f];
  }

  if (updates.tier && !VALID_TIERS.includes(updates.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (updates.contentType && !VALID_CONTENT_TYPES.includes(updates.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }

  const effectiveContentType = updates.contentType || existing.content_type;
  const isNewSeries = updates.seriesId === '__new__';

  const dbUpdates = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.artist !== undefined) dbUpdates.artist = updates.artist;
  if (updates.runtime !== undefined) dbUpdates.runtime = updates.runtime;
  if (updates.genre !== undefined) dbUpdates.genre = updates.genre;
  if (updates.mainGenre !== undefined) dbUpdates.main_genre = updates.mainGenre;
  if (updates.tier !== undefined) dbUpdates.tier = updates.tier;
  if (updates.rating !== undefined) dbUpdates.rating = updates.rating;
  if (updates.releaseYear !== undefined) {
    const year = Number(updates.releaseYear);
    dbUpdates.release_year = Number.isInteger(year) ? year : null;
  }
  if (updates.contentType !== undefined) dbUpdates.content_type = updates.contentType;
  if (updates.seriesId !== undefined) dbUpdates.series_id = effectiveContentType === 'series' && !isNewSeries ? updates.seriesId : null;
  if (updates.season !== undefined) dbUpdates.season = effectiveContentType === 'series' ? Number(updates.season) || 1 : null;
  if (updates.seriesOrder !== undefined) dbUpdates.series_order = effectiveContentType === 'series' ? Number(updates.seriesOrder) : null;

  if (Object.keys(dbUpdates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  // The `.eq('status', 'pending')` here is the real enforcement, same
  // pattern as review-submission.js — even if two requests race, only one
  // can land while status is still pending.
  const { error } = await supabase
    .from('episodes')
    .update(dbUpdates)
    .eq('id', episodeId)
    .eq('submitted_by', userId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    console.error('edit-submission error:', error.message);
    return res.status(500).json({ error: 'Could not save your changes.' });
  }

  return res.status(200).json({ ok: true, episodeId });
}
