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
      .from('series')
      .select('id, name, description, poster, thumbnail, submitted_by, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ series: data || [] });
  }

  if (req.method === 'POST') {
    const { seriesId, decision } = req.body || {};
    if (!seriesId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'seriesId and a valid decision (approved/rejected) are required.' });
    }
    const { error } = await supabase
      .from('series')
      .update({ status: decision, reviewed_by: email, reviewed_at: new Date().toISOString() })
      .eq('id', seriesId);
    if (error) return res.status(500).json({ error: error.message });

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: `series_${decision}`,
      targetType: 'series',
      targetId: seriesId
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
