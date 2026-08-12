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
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('audit-log error:', error.message);
    return res.status(500).json({ error: 'Could not load the audit log.' });
  }

  return res.status(200).json({
    entries: (data || []).map((e) => ({
      id: e.id,
      adminEmail: e.admin_email,
      action: e.action,
      targetType: e.target_type,
      targetId: e.target_id,
      details: e.details,
      createdAt: e.created_at
    }))
  });
}
