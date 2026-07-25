import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';

// Unlike pages/api/creator/edit-submission.js, this has no ownership
// check and no "must still be pending" restriction — an admin can fix or
// adjust anything in the library, including un-approving something that
// shouldn't have gone live (by setting status back to 'pending' or
// 'rejected') or toggling the homepage hero eligibility flag.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

const VALID_TIERS = ['free', 'premium'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'status', 'featured'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { episodeId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, ...fields } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('episodes').select('id, title, poster, thumbnail, status, submitted_by').eq('id', episodeId).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Episode not found.' });
  }

  if (fields.tier && !VALID_TIERS.includes(fields.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (fields.status && !VALID_STATUSES.includes(fields.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  let poster;
  let thumbnail;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `${episodeId}-poster` }),
      uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `${episodeId}-thumbnail` })
    ]);
  } catch (err) {
    console.error('admin edit-episode artwork error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const dbUpdates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    dbUpdates[f === 'mainGenre' ? 'main_genre' : f] = fields[f];
  }
  // Changing status here is a deliberate admin override outside the normal
  // approve/reject review flow — e.g. un-approving something. Stamp
  // reviewed_at so turnaround stats stay meaningful.
  if (dbUpdates.status) dbUpdates.reviewed_at = new Date().toISOString();
  if (poster) dbUpdates.poster = poster;
  if (thumbnail) dbUpdates.thumbnail = thumbnail;

  if (poster && existing.poster) {
    const oldPath = storagePathFromUrl(existing.poster);
    if (oldPath) recordOrphan({ kind: 'storage_image', reference: oldPath, reason: 'artwork replaced by admin (poster)', context: existing.title });
  }
  if (thumbnail && existing.thumbnail) {
    const oldPath = storagePathFromUrl(existing.thumbnail);
    if (oldPath) recordOrphan({ kind: 'storage_image', reference: oldPath, reason: 'artwork replaced by admin (thumbnail)', context: existing.title });
  }

  if (Object.keys(dbUpdates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const { error } = await supabase.from('episodes').update(dbUpdates).eq('id', episodeId);
  if (error) {
    console.error('admin edit-episode db error:', error.message);
    return res.status(500).json({ error: 'Could not save changes.' });
  }

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'edit_episode',
    targetType: 'episode',
    targetId: episodeId,
    details: `${existing.title} — fields changed: ${Object.keys(dbUpdates).join(', ')}`
  });

  // A status override outside the normal review flow (e.g. un-approving
  // something) is worth telling the creator about — everything else here
  // (title tweaks, tier, artwork) is routine housekeeping, not something
  // that needs its own notification.
  if (dbUpdates.status && dbUpdates.status !== existing.status) {
    await notifyCreator({
      userId: existing.submitted_by,
      type: 'status_changed_by_admin',
      message: `An admin changed "${existing.title}"'s status to ${dbUpdates.status}.`,
      episodeId
    });
  }

  return res.status(200).json({ ok: true, episodeId });
}
