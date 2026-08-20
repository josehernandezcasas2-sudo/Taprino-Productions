import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';

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
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast'];
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'status', 'featured', 'availableFrom', 'availableUntil', 'adsEnabled', 'contentType', 'seriesId', 'season', 'seriesOrder'];
const FIELD_TO_COLUMN = { mainGenre: 'main_genre', availableFrom: 'available_from', availableUntil: 'available_until', adsEnabled: 'ads_enabled', contentType: 'content_type', seriesId: 'series_id', seriesOrder: 'series_order' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, email, isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { episodeId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, cloudflareVideoUid, ...fields } = req.body || {};
  if (!episodeId) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('episodes').select('id, title, poster, thumbnail, src, status, submitted_by').eq('id', episodeId).maybeSingle();
  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Episode not found.' });
  }

  if (fields.tier && !VALID_TIERS.includes(fields.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (fields.status && !VALID_STATUSES.includes(fields.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (fields.contentType && !VALID_CONTENT_TYPES.includes(fields.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }
  if (fields.contentType === 'series' && !fields.seriesId) {
    return res.status(400).json({ error: 'A series must be selected when content type is "series".' });
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

  // Manual video replacement — the fallback for when a creator's in-app
  // upload keeps failing: the file gets uploaded directly through
  // Cloudflare's own dashboard, and this just links the resulting video ID
  // to the episode. Same integrity check as manual-episode.js: Cloudflare's
  // own transcoding has to have actually succeeded before this gets wired in.
  let newSrc;
  if (cloudflareVideoUid) {
    const videoStatus = await getCloudflareVideoStatus(cloudflareVideoUid);
    if (!videoStatus) {
      return res.status(404).json({ error: 'No Cloudflare video found with that ID.' });
    }
    if (videoStatus.state === 'error') {
      return res.status(400).json({ error: `Cloudflare could not process this video: ${videoStatus.errorReasonText || videoStatus.errorReasonCode}.` });
    }
    newSrc = cloudflarePlaybackUrl(cloudflareVideoUid);
    const oldUid = cloudflareUidFromUrl(existing.src);
    if (oldUid && oldUid !== cloudflareVideoUid) {
      await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video manually replaced by admin', context: existing.title });
    }
  }

  const dbUpdates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    const column = FIELD_TO_COLUMN[f] || f;
    // Date inputs send '' when cleared, not null — treat that as "remove
    // this date" rather than trying to store an empty string in a
    // timestamptz column, which Postgres would reject outright.
    if ((f === 'availableFrom' || f === 'availableUntil') && fields[f] === '') {
      dbUpdates[column] = null;
    } else if (f === 'season' || f === 'seriesOrder') {
      // Number inputs also arrive as strings — cast for the int columns,
      // and treat '' (cleared, only seriesOrder is realistically ever
      // left blank) as null rather than storing NaN.
      dbUpdates[column] = fields[f] === '' ? null : Number(fields[f]);
    } else {
      dbUpdates[column] = fields[f];
    }
  }
  // Switching away from 'series' leaves the episode's old series_id/season/
  // series_order pointing at a series it's no longer part of — clear them
  // so it doesn't keep showing up consolidated under that series' card
  // elsewhere on the site.
  if (dbUpdates.content_type && dbUpdates.content_type !== 'series') {
    dbUpdates.series_id = null;
    dbUpdates.season = null;
    dbUpdates.series_order = null;
  }
  // Changing status here is a deliberate admin override outside the normal
  // approve/reject review flow — e.g. un-approving something. Stamp
  // reviewed_at so turnaround stats stay meaningful.
  if (dbUpdates.status) dbUpdates.reviewed_at = new Date().toISOString();
  if (poster) dbUpdates.poster = poster;
  if (thumbnail) dbUpdates.thumbnail = thumbnail;
  if (newSrc) dbUpdates.src = newSrc;

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
