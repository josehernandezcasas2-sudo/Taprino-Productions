import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

// KNOWN GAP: confirming an episode deletion removes the database row but
// does not delete the underlying Cloudflare Stream video or the uploaded
// poster/thumbnail from Supabase Storage — those are orphaned rather than
// cleaned up. Worth a follow-up (a scheduled job or a call out to
// Cloudflare's delete-video API here) once storage costs actually matter;
// not wired up yet.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { type, id, decision } = req.body || {};
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['confirm', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "confirm" or "deny".' });
  }

  const supabase = getSupabase();
  const table = type === 'episode' ? 'episodes' : 'series';

  if (decision === 'deny') {
    const { error } = await supabase
      .from(table)
      .update({ deletion_requested: false, deletion_reason: null, deletion_requested_at: null })
      .eq('id', id)
      .eq('deletion_requested', true);
    if (error) {
      console.error('resolve-deletion deny error:', error.message);
      return res.status(500).json({ error: 'Could not deny the deletion request.' });
    }
    return res.status(200).json({ ok: true, type, id, decision: 'deny' });
  }

  // decision === 'confirm'
  if (type === 'series') {
    // A series can't be safely removed while episodes still point at it —
    // the database's own foreign key would reject this anyway, but a
    // clear message here beats a raw Postgres constraint error reaching
    // the admin UI.
    const { count, error: countError } = await supabase
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .eq('series_id', id);
    if (countError) {
      console.error('resolve-deletion series count error:', countError.message);
      return res.status(500).json({ error: 'Could not check this series for attached episodes.' });
    }
    if (count && count > 0) {
      return res.status(400).json({ error: `This series still has ${count} episode${count === 1 ? '' : 's'} attached — reassign or delete those first.` });
    }
  }

  const { error } = await supabase.from(table).delete().eq('id', id).eq('deletion_requested', true);
  if (error) {
    console.error('resolve-deletion confirm error:', error.message);
    return res.status(500).json({ error: 'Could not delete this.' });
  }

  return res.status(200).json({ ok: true, type, id, decision: 'confirm' });
}
