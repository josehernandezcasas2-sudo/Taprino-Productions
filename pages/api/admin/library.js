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

  const { q } = req.query || {};

  const supabase = getSupabase();
  let query = supabase
    .from('episodes')
    .select('id, title, description, tier, status, content_type, genre, main_genre, series_id, artist, runtime, poster, thumbnail, src, featured, deletion_requested, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  // Simple free-text match on title or artist — good enough at the scale
  // of one studio's library; worth a real search index if this ever grows
  // into the thousands of episodes.
  if (q && String(q).trim() !== '') {
    const term = String(q).trim();
    query = query.or(`title.ilike.%${term}%,artist.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('admin library error:', error.message);
    return res.status(500).json({ error: 'Could not load the library.' });
  }

  return res.status(200).json({
    episodes: (data || []).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      tier: e.tier,
      status: e.status,
      contentType: e.content_type,
      genre: e.genre,
      mainGenre: e.main_genre,
      seriesId: e.series_id,
      artist: e.artist,
      runtime: e.runtime,
      poster: e.poster,
      thumbnail: e.thumbnail,
      // This was the bug behind "I saved a Cloudflare ID, came back, and it
      // said there was no video." The query above always fetched `src`, but
      // this mapping dropped it — so the edit modal received `undefined` and
      // correctly reported "no video attached," even for episodes that had
      // one saved perfectly well. The save path was never broken; the read
      // path just never returned the field.
      src: e.src,
      featured: e.featured,
      deletionRequested: e.deletion_requested,
      createdAt: e.created_at
    }))
  });
}
