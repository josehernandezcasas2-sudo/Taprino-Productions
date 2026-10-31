import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import {
  rightsVerdict, acceptApplication, holdApplication, declineApplication, refreshVideoState, signedMediaFor, isOpenStatus
} from '../../../lib/creatorApplications';
import { sendError } from '../../../lib/apiErrors';

const STATUSES = ['new', 'reviewing', 'held', 'accepted', 'declined'];

// Reads and status changes need the manage_applications capability (the
// same gate as /admin/applications itself). Accepting is admin-only,
// because it grants the creator role, and role grants are deliberately
// not delegable to sub-admins (see lib/capabilities.js).
//
// POST { id, status, adminNotes?, decisionNote?, tier? }:
//   accepted → lib/creatorApplications.js acceptApplication: with the
//              master uploaded the title goes live now (tier free|premium),
//              Creator Studio is granted, "it's live" is emailed;
//   held     → the note is what to fix, emailed;
//   declined → the master is deleted, the note emailed;
//   reviewing / no status → bookkeeping only.
export default async function handler(req, res) {
  const roleContext = await requireCapability(req, res, 'manage_applications');
  if (!roleContext) return;
  const { userId, email } = roleContext;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('creator_applications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return sendError(res, error, 'admin/applications');
    const applications = [];
    for (const raw of data || []) {
      // An open application's upload state comes from Cloudflare while it
      // isn't final; the signed master is there to watch in place.
      const a = isOpenStatus(raw.status) ? await refreshVideoState(raw) : raw;
      const media = isOpenStatus(a.status) ? await signedMediaFor(a) : null;
      applications.push({ ...a, rights_holds: rightsVerdict(a.rights_answers).holds, media });
    }
    return res.status(200).json({ applications });
  }

  if (req.method === 'POST') {
    const { id, status, adminNotes, decisionNote, tier } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
      // The reviewer's private notes save on their own, whatever else happens.
      if (adminNotes !== undefined) {
        const { error } = await supabase.from('creator_applications').update({ admin_notes: adminNotes ? String(adminNotes).slice(0, 5000) : null }).eq('id', id);
        if (error) return sendError(res, error, 'admin/applications');
      }

      if (status === 'accepted') {
        const result = await acceptApplication(roleContext, { id, tier, note: decisionNote });
        return res.status(200).json(result);
      }
      if (status === 'held') {
        return res.status(200).json(await holdApplication(roleContext, { id, note: decisionNote }));
      }
      if (status === 'declined') {
        return res.status(200).json(await declineApplication(roleContext, { id, note: decisionNote }));
      }

      const { data: before } = await supabase.from('creator_applications').select('id, title, status').eq('id', id).maybeSingle();
      if (!before) return res.status(404).json({ error: 'No such application.' });
      const update = { reviewed_by: userId, reviewed_at: new Date().toISOString() };
      if (status) update.status = status;
      if (decisionNote !== undefined) update.decision_note = decisionNote ? String(decisionNote).trim().slice(0, 2000) || null : null;
      const { data, error } = await supabase.from('creator_applications').update(update).eq('id', id).select().single();
      if (error) return sendError(res, error, 'admin/applications');
      await recordAudit({ adminId: userId, adminEmail: email, action: `application_${status || 'note'}`, targetType: 'creator_application', targetId: id, details: data.title });
      return res.status(200).json({ application: { ...data, rights_holds: rightsVerdict(data.rights_answers).holds }, roleGranted: false, needsManualGrant: false });
    } catch (err) {
      return sendError(res, err, 'admin/applications');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
