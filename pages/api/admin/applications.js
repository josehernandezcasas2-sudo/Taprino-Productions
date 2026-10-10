import { requireCapability } from '../../../lib/adminAuth';
import { getUserRole, setUserRole } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { recordAudit } from '../../../lib/auditLog';
import { sendEmail } from '../../../lib/notify';
import { applicationEmails, rightsVerdict } from '../../../lib/creatorApplications';

const STATUSES = ['new', 'reviewing', 'accepted', 'declined'];

// Reads and status changes need the manage_applications capability (the
// same gate as /admin/applications itself). Accepting is admin-only,
// because it grants the creator role, and role grants are deliberately
// not delegable to sub-admins (see lib/capabilities.js).
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
    if (error) return res.status(500).json({ error: error.message });
    // The reviewer sees the paperwork list the applicant was shown.
    const applications = (data || []).map((a) => ({ ...a, rights_holds: rightsVerdict(a.rights_answers).holds }));
    return res.status(200).json({ applications });
  }

  if (req.method === 'POST') {
    const { id, status, adminNotes, decisionNote } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    if (status === 'accepted' && !roleContext.isAdmin) {
      return res.status(403).json({ error: 'Only a full admin can accept an application, since that grants Creator Studio.' });
    }

    const { data: before, error: readError } = await supabase.from('creator_applications').select('*').eq('id', id).maybeSingle();
    if (readError) return res.status(500).json({ error: readError.message });
    if (!before) return res.status(404).json({ error: 'No such application.' });

    const update = { reviewed_by: userId, reviewed_at: new Date().toISOString() };
    if (status) update.status = status;
    if (adminNotes !== undefined) update.admin_notes = adminNotes;
    if (decisionNote !== undefined) update.decision_note = decisionNote ? String(decisionNote).trim().slice(0, 2000) || null : null;

    // Accepting gives the applicant Creator Studio right away. Someone
    // who already has a team role (creator, scheduler, admin) keeps it.
    let roleGranted = false;
    let needsManualGrant = false;
    if (status === 'accepted') {
      if (before.user_id) {
        try {
          const current = await getUserRole(before.user_id);
          if (!current) {
            await setUserRole(before.user_id, 'creator');
            roleGranted = true;
          }
          update.role_granted_at = new Date().toISOString();
        } catch (err) {
          console.error('applications: grant creator role failed:', err.message);
          return res.status(500).json({ error: 'Could not grant the creator role. Nothing was changed.' });
        }
      } else {
        // An application from before accounts were required: grant by
        // email under People instead.
        needsManualGrant = true;
      }
    }

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
      details: roleGranted ? `${data.title} (creator role granted to ${data.email})` : data.title
    });

    // The decision reaches the applicant by email too, with the note.
    const decided = status && status !== before.status && (status === 'accepted' || status === 'declined');
    if (decided && data.email) {
      const mail = applicationEmails[status]({ name: data.name, title: data.title, note: data.decision_note });
      await sendEmail({ to: data.email, ...mail });
    }

    return res.status(200).json({
      application: { ...data, rights_holds: rightsVerdict(data.rights_answers).holds },
      roleGranted,
      needsManualGrant
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
