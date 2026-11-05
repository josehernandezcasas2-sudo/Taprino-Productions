import { getRoleContext, listCreatorsAndAdmins } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { isTitleId } from '../../../lib/titleIds';
import { showRouteError } from '../../../lib/showRoute';
import { setShowOwner } from '../../../lib/showAdmin';

// GET → { series: [{ id, name, ownerEmail }] } (the old Series ownership
// card; Admin → Shows' Creators tab reads the roster now).
// POST { seriesId, ownerEmail } → { ok: true }: who runs a show, through
// lib/showAdmin.js setShowOwner since the series revamp's slice 3a (both
// accounts are told, the caches cleared, one audit line). A blank email
// clears the owner. Full admins only.

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
    if (typeof seriesId !== 'string' || !isTitleId(seriesId)) {
      return res.status(400).json({ error: 'seriesId is required.' });
    }
    try {
      await setShowOwner(seriesId, { email: typeof ownerEmail === 'string' ? ownerEmail : null }, { userId, email, isAdmin });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return showRouteError(res, err, 'admin/series-ownership', 'Could not update ownership.');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
