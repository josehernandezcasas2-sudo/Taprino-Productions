import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

// GET  -> list the current invite list
// POST -> add an email { email, reason }
// DELETE -> remove an email { email }
export default async function handler(req, res) {
  const roleContext = await requireCapability(req, res, 'manage_comped_access');
  if (!roleContext) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('comped_access')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('comped-access GET error:', error.message);
      return res.status(500).json({ error: 'Could not load the invite list.' });
    }
    return res.status(200).json({ comped: data });
  }

  if (req.method === 'POST') {
    const { email, reason } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    const { error } = await supabase
      .from('comped_access')
      .insert({ email: email.trim().toLowerCase(), reason: reason || null, granted_by: roleContext.email });
    if (error) {
      // unique violation = already on the list, not really an error worth alarming over
      if (error.code === '23505') {
        return res.status(200).json({ ok: true, note: 'Already on the list.' });
      }
      console.error('comped-access POST error:', error.message);
      return res.status(500).json({ error: 'Could not add that email.' });
    }
    await recordAudit({
      adminId: roleContext.userId,
      adminEmail: roleContext.email,
      action: 'grant_comped_access',
      targetType: 'comped_access',
      details: email
    });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'email is required.' });
    }
    const { error } = await supabase.from('comped_access').delete().ilike('email', email);
    if (error) {
      console.error('comped-access DELETE error:', error.message);
      return res.status(500).json({ error: 'Could not remove that email.' });
    }
    await recordAudit({
      adminId: roleContext.userId,
      adminEmail: roleContext.email,
      action: 'revoke_comped_access',
      targetType: 'comped_access',
      details: email
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
