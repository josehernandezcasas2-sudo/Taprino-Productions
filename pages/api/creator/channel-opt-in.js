import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// POST { type: 'episode' | 'series', id, optIn: true | false }
// A creator decides whether channels may air their work. Turning it off
// takes effect right away: the channel engine only ever airs opted-in
// titles, so any slot or loop entry pointing at this falls through to the
// next thing in line. Only the title's own creator (or an admin) can flip it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) return res.status(403).json({ error: 'Creator access required.' });

  const { type, id, optIn } = req.body || {};
  if (!['episode', 'series'].includes(type) || !id || typeof optIn !== 'boolean') {
    return res.status(400).json({ error: 'type (episode or series), id and optIn (true/false) are required.' });
  }

  const supabase = getSupabase();
  const table = type === 'episode' ? 'episodes' : 'series';
  const ownerField = type === 'episode' ? 'submitted_by' : 'creator_id';
  const { data: row, error } = await supabase.from(table).select(`id, ${ownerField}`).eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (!isAdmin && row[ownerField] !== userId) {
    return res.status(403).json({ error: type === 'series' ? "Only the show's creator can change this." : 'You can only change your own titles.' });
  }

  const { error: upErr } = await supabase.from(table).update({ channel_opt_in: optIn }).eq('id', id);
  if (upErr) return res.status(500).json({ error: upErr.message });
  return res.status(200).json({ ok: true, optIn });
}
