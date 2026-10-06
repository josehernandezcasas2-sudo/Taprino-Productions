import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { userId } = await getRoleContext(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pitch_swipe_progress')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('pitch-swipe-progress GET error:', error.message);
      return res.status(500).json({ error: 'Could not load your progress.' });
    }
    if (!data) return res.status(200).json({ progress: null });
    return res.status(200).json({
      progress: {
        deckIds: data.deck_ids || [],
        secondChanceIds: data.second_chance_ids || [],
        round: data.round || 1,
        likedIds: data.liked_ids || [],
        floorIndex: Number.isInteger(data.floor_index) ? data.floor_index : 0
      }
    });
  }

  if (req.method === 'POST') {
    const { deckIds, secondChanceIds, round, likedIds, floorIndex } = req.body || {};
    if (!Array.isArray(deckIds) || !Array.isArray(secondChanceIds) || !Array.isArray(likedIds)) {
      return res.status(400).json({ error: 'deckIds, secondChanceIds, and likedIds must be arrays.' });
    }
    const row = {
      user_id: userId,
      deck_ids: deckIds,
      second_chance_ids: secondChanceIds,
      round: round === 2 ? 2 : 1,
      liked_ids: likedIds,
      updated_at: new Date().toISOString()
    };
    // Only the website's elevator sends floorIndex (it keeps the whole
    // ordered deck and a position in it; the mobile swipe deck still
    // sends just the cards ahead of you). Written only when present so
    // the mobile app isn't affected by the floor_index column from
    // migration 073 either way.
    if (floorIndex !== undefined) {
      if (!Number.isInteger(floorIndex) || floorIndex < 0) {
        return res.status(400).json({ error: 'floorIndex must be a non-negative integer.' });
      }
      row.floor_index = floorIndex;
    }
    const { error } = await supabase.from('pitch_swipe_progress').upsert(row);
    if (error) {
      console.error('pitch-swipe-progress POST error:', error.message);
      return res.status(500).json({ error: 'Could not save your progress.' });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('pitch_swipe_progress').delete().eq('user_id', userId);
    if (error) {
      console.error('pitch-swipe-progress DELETE error:', error.message);
      return res.status(500).json({ error: 'Could not clear your progress.' });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
