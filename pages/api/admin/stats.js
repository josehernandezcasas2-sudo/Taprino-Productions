import { getRoleContext, listCreatorsAndAdmins } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { getViewCounts } from '../../../lib/redis';

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
  const [{ data: episodes, error }, creators, viewCounts] = await Promise.all([
    supabase.from('episodes').select('status, created_at, reviewed_at'),
    listCreatorsAndAdmins(),
    getViewCounts()
  ]);

  if (error) {
    console.error('admin stats error:', error.message);
    return res.status(500).json({ error: 'Could not load stats.' });
  }

  const rows = episodes || [];
  const pendingCount = rows.filter((e) => e.status === 'pending').length;
  const approvedCount = rows.filter((e) => e.status === 'approved').length;
  const rejectedCount = rows.filter((e) => e.status === 'rejected').length;
  const reviewedCount = approvedCount + rejectedCount;
  const approvalRate = reviewedCount > 0 ? Math.round((approvedCount / reviewedCount) * 100) : null;

  const turnaroundHours = rows
    .filter((e) => e.reviewed_at && e.created_at)
    .map((e) => (new Date(e.reviewed_at).getTime() - new Date(e.created_at).getTime()) / (1000 * 60 * 60));
  const avgTurnaroundHours = turnaroundHours.length > 0
    ? Math.round(turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length)
    : null;

  const totalViews = Object.values(viewCounts || {}).reduce((a, b) => a + b, 0);

  return res.status(200).json({
    total: rows.length,
    pendingCount,
    approvedCount,
    rejectedCount,
    approvalRate,
    avgTurnaroundHours,
    creatorCount: creators.filter((c) => c.role === 'creator').length,
    adminCount: creators.filter((c) => c.role === 'admin').length,
    totalViews
  });
}
