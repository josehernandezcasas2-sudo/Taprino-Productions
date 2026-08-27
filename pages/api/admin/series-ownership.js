import { getRoleContext, findUserByEmail, listCreatorsAndAdmins } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';

export default async function handler(req, res) {
  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const [{ data, error }, roster] = await Promise.all([
      supabase.from('series').select('id, name, creator_id').order('name', { ascending: true }),
      listCreatorsAndAdmins()
    ]);
    if (error) {
      console.error('series-ownership GET error:', error.message);
      return res.status(500).json({ error: 'Could not load series.' });
    }
    // creator_id only ever stores a Clerk user id, not anything display-
    // friendly — resolved against the same roster the Creator access card
    // already uses, so the admin sees an actual email instead of a raw id.
    const emailById = Object.fromEntries(roster.map((r) => [r.id, r.email]));
    const series = (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      ownerEmail: s.creator_id ? (emailById[s.creator_id] || '(account not found)') : null
    }));
    return res.status(200).json({ series });
  }

  if (req.method === 'POST') {
    const { seriesId, ownerEmail } = req.body || {};
    if (!seriesId) {
      return res.status(400).json({ error: 'seriesId is required.' });
    }

    // Blank ownerEmail is a valid, intentional action — it clears
    // ownership back to unassigned, not an error.
    let newOwnerId = null;
    if (ownerEmail && ownerEmail.trim()) {
      const owner = await findUserByEmail(ownerEmail.trim());
      if (!owner) {
        return res.status(404).json({ error: `No account found for ${ownerEmail} — they need to have signed up already.` });
      }
      newOwnerId = owner.id;
    }

    const { error } = await supabase.from('series').update({ creator_id: newOwnerId }).eq('id', seriesId);
    if (error) {
      console.error('series-ownership POST error:', error.message);
      return res.status(500).json({ error: 'Could not update ownership.' });
    }

    await recordAudit({
      adminId: userId,
      adminEmail: email,
      action: newOwnerId ? 'series_ownership_assigned' : 'series_ownership_cleared',
      targetType: 'series',
      targetId: seriesId,
      details: newOwnerId ? `Assigned to ${ownerEmail.trim()}` : 'Ownership cleared'
    });

    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
