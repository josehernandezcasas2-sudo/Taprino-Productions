import { getRoleContext } from '../../lib/roles';
import { getSupabase } from '../../lib/supabase';

export default async function handler(req, res) {
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
        likedIds: data.liked_ids || []
      }
    });
  }

  if (req.method === 'POST') {
    const { deckIds, secondChanceIds, round, likedIds } = req.body || {};
    if (!Array.isArray(deckIds) || !Array.isArray(secondChanceIds) || !Array.isArray(likedIds)) {
      return res.status(400).json({ error: 'deckIds, secondChanceIds, and likedIds must be arrays.' });
    }
    const { error } = await supabase.from('pitch_swipe_progress').upsert({
      user_id: userId,
      deck_ids: deckIds,
      second_chance_ids: secondChanceIds,
      round: round === 2 ? 2 : 1,
      liked_ids: likedIds,
      updated_at: new Date().toISOString()
    });
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
