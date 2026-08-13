import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('creator_applications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ applications: data || [] });
  }

  if (req.method === 'POST') {
    const { id, status, adminNotes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });
    if (status && !['new', 'reviewing', 'accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const update = { reviewed_by: userId, reviewed_at: new Date().toISOString() };
    if (status) update.status = status;
    if (adminNotes !== undefined) update.admin_notes = adminNotes;

    const { data, error } = await supabase
      .from('creator_applications')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `application_${status || 'note'}`,
      targetType: 'creator_application',
      targetId: id,
      details: data.title
    });

    return res.status(200).json({ application: data });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
