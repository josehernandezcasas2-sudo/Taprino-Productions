import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { historyEntry } from '../../../lib/showAdminRules';

// GET → { entries }: the newest audit lines (full admins). Since the series
// revamp's slice 3a (amendment 18) the creators' own changes on their show
// pages (rows whose details are JSON with actor 'owner') are left out by
// default — they are the show's History — except a show going public
// (show_live); ?owners=1 keeps them. Up to 400 rows are read and at most
// 200 answered. Each entry carries `words` (the JSON's words, else the
// text) and `actor` ('owner' | 'admin' | null).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const owners = req.query && req.query.owners === '1';
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) {
    console.error('audit-log error:', error.message);
    return res.status(500).json({ error: 'Could not load the audit log.' });
  }

  const entries = [];
  for (const e of data || []) {
    const h = historyEntry(e, {});
    if (!owners && h.actor === 'owner' && e.action !== 'show_live') continue;
    entries.push({
      id: e.id,
      adminEmail: e.admin_email,
      action: e.action,
      targetType: e.target_type,
      targetId: e.target_id,
      details: e.details,
      words: h.words,
      actor: h.actor,
      createdAt: e.created_at
    });
    if (entries.length >= 200) break;
  }
  return res.status(200).json({ entries, owners });
}
