import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// Closes a real gap: today, picking "a new series not listed here" on the
// episode form just leaves series_id null and asks the creator to mention
// the name in their description — an admin has to manually create the
// real series row later. This lets a creator set the series up themselves
// right away, with its own trailer/artwork, so a whole new show doesn't
// need to wait on you.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator } = await getRoleContext(req);
  if (!isCreator) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { name, description } = req.body || {};
  if (!name || String(name).trim() === '') {
    return res.status(400).json({ error: 'A series name is required.' });
  }

  // Same slugging approach as episode ids — a timestamp suffix avoids
  // needing to handle name collisions as an error case.
  const id = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

  const supabase = getSupabase();
  const { error } = await supabase.from('series').insert({
    id,
    name,
    description: description || null,
    creator_id: userId
  });

  if (error) {
    console.error('create-series error:', error.message);
    return res.status(500).json({ error: 'Could not create the series.' });
  }

  return res.status(200).json({ ok: true, id, name });
}
