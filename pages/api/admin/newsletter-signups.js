import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';

export default async function handler(req, res) {
  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('newsletter_signups')
    .select('email, source, synced_to_esp, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (req.query.format === 'csv') {
    const header = 'email,source,synced_to_esp,created_at';
    const rows = data.map((r) => [r.email, r.source || '', r.synced_to_esp, r.created_at].join(','));
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="newsletter-signups.csv"');
    return res.status(200).send(csv);
  }

  return res.status(200).json({ count: data.length, signups: data });
}
