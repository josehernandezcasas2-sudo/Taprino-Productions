import { getRoleContext, listCreatorsAndAdmins } from '../../../lib/roles';
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
  const [creators, { data: episodes, error }] = await Promise.all([
    listCreatorsAndAdmins(),
    supabase.from('episodes').select('submitted_by, status')
  ]);

  if (error) {
    console.error('admin creators error:', error.message);
    return res.status(500).json({ error: 'Could not load the creator roster.' });
  }

  const roster = creators.map((c) => {
    const own = (episodes || []).filter((e) => e.submitted_by === c.id);
    const approved = own.filter((e) => e.status === 'approved').length;
    const pending = own.filter((e) => e.status === 'pending').length;
    const rejected = own.filter((e) => e.status === 'rejected').length;
    const reviewed = approved + rejected;
    return {
      id: c.id,
      email: c.email,
      role: c.role,
      joinedAt: c.joinedAt,
      totalSubmissions: own.length,
      approved,
      pending,
      rejected,
      approvalRate: reviewed > 0 ? Math.round((approved / reviewed) * 100) : null
    };
  });

  // Most active first — an admin managing access is more likely to be
  // looking at whoever's actually submitting, not an alphabetical list.
  roster.sort((a, b) => b.totalSubmissions - a.totalSubmissions);

  return res.status(200).json({ creators: roster });
}
