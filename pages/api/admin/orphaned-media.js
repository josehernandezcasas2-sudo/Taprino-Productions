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
  const { data, error } = await supabase
    .from('orphaned_media')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('orphaned-media error:', error.message);
    return res.status(500).json({ error: 'Could not load orphaned media.' });
  }

  return res.status(200).json({
    orphans: (data || []).map((o) => ({
      id: o.id,
      kind: o.kind,
      reference: o.reference,
      reason: o.reason,
      context: o.context,
      createdAt: o.created_at
    }))
  });
}
