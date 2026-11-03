import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl } from '../../../lib/cloudflareUpload';
import { recordOrphan } from '../../../lib/orphanedMedia';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { internalError, sendError } from '../../../lib/apiErrors';
import { isTitleId } from '../../../lib/titleIds';
import { holdsSlot, slotCheck } from '../../../lib/showRules';

// Replacing the video is different from replacing artwork: an admin
// approved a SPECIFIC video file, not just the metadata around it. If the
// episode was already approved and live, swapping the underlying file
// without another look would let anyone with creator access put literally
// anything behind an already-trusted "approved" episode — a real content-
// safety gap, not just a workflow nicety. So this always sends the
// episode back into the pending queue when the previous status was
// approved or rejected; a still-pending episode (never reviewed yet)
// just gets the new file in place, since nothing has signed off on it either way.
//
// A declined episode doesn't hold its number (amendment 6 of the series
// revamp: migration 118's unique index skips declined rows), so another
// episode may have taken it while it was declined. Coming back into
// review it keeps its number when that's still free and takes the
// season's next free one when it isn't: this answers after the upload,
// and a refusal here would throw the creator's file away. The answer says
// so (`renumbered` and `message`, which the upload widget shows); the
// number can be changed while it's in review. An approved episode already
// holds its place and keeps it.

const NUMBERED_TYPES = ['series', 'podcast'];
// What the numbering rules read of a show's episodes (lib/showRules.js
// slotCheck), all older than migration 118.
const SLOT_COLUMNS = 'id, title, status, content_type, season, series_order, withdrawn_at, deletion_requested, created_at';

// Migration 118's unique index on (series_id, season, series_order).
function positionTaken(error) {
  return Boolean(error) && error.code === '23505' && /episodes_show_position_uq/.test(error.message || '');
}

function renumberedLine({ season, from, to }) {
  const place = season > 1 ? `Season ${season}, episode ${to}` : `episode ${to}`;
  return `It’s back in review as ${place} — episode ${from} was taken while it was declined. You can change the number while it’s in review.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await replaceVideo(req, res);
  } catch (err) {
    return sendError(res, err, 'creator/replace-video', 'Could not save the replacement video.');
  }
}

async function replaceVideo(req, res) {
  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { episodeId, videoUid } = req.body || {};
  if (!episodeId || !videoUid) {
    return res.status(400).json({ error: 'episodeId and videoUid are required.' });
  }
  if (!isTitleId(String(episodeId))) {
    return res.status(404).json({ error: 'Episode not found.' });
  }
  // The id becomes the episode's video address below, an admin's too.
  if (!VIDEO_UID_PATTERN.test(String(videoUid))) {
    return res.status(400).json({ error: 'That doesn’t look like a video id from this site.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('episodes')
    .select('id, title, submitted_by, status, src, deletion_requested, content_type, series_id, season, series_order, withdrawn_at')
    .eq('id', String(episodeId))
    .maybeSingle();

  if (fetchError) throw internalError(fetchError, 'replace-video read');
  if (!existing) {
    return res.status(404).json({ error: 'Episode not found.' });
  }
  if (existing.submitted_by !== userId) {
    return res.status(403).json({ error: 'That episode does not belong to you.' });
  }
  if (existing.deletion_requested) {
    return res.status(400).json({ error: 'This episode has a pending deletion request — cancel that first if you want to replace its video.' });
  }

  // The new file has to be this creator's own upload (lib/videoOwnership.js;
  // security round, 2026-10-26). Before, any video id in the account could
  // be attached here, unlike submit-episode.
  if (!isAdmin) {
    const owned = await checkVideoOwnership(videoUid, { userId });
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error });
  }

  const newSrc = cloudflarePlaybackUrl(videoUid);
  if (!newSrc) {
    return res.status(500).json({ error: 'Could not resolve the uploaded video — is Cloudflare Stream fully configured?' });
  }

  const dbUpdates = { src: newSrc };
  if (existing.status === 'approved' || existing.status === 'rejected') {
    dbUpdates.status = 'pending';
    dbUpdates.rejection_reason = null;
    dbUpdates.reviewed_at = null;
  }

  // A declined series or podcast episode with a number takes its place in
  // the running order again: its number if still free, else the next free
  // one in its season.
  const returning = existing.status === 'rejected'
    && NUMBERED_TYPES.includes(existing.content_type)
    && Boolean(existing.series_id)
    && holdsSlot({ ...existing, status: 'pending' });
  let renumbered = null;
  async function takePlace() {
    const { data: rows, error } = await supabase.from('episodes').select(SLOT_COLUMNS).eq('series_id', existing.series_id);
    if (error) throw internalError(error, 'replace-video slots');
    const slot = slotCheck(rows || [], { season: existing.season, number: existing.series_order, excludeId: existing.id });
    const to = slot.free ? existing.series_order : slot.nextFree;
    // No season plays as Season 1 (lib/showRules.js); written, so the
    // check and the index read the same place.
    if (existing.season === null || existing.season === undefined) dbUpdates.season = slot.season;
    if (to === existing.series_order) {
      delete dbUpdates.series_order;
      renumbered = null;
    } else {
      dbUpdates.series_order = to;
      renumbered = { season: slot.season, from: existing.series_order, to };
    }
  }
  if (returning) await takePlace();

  const write = () => supabase.from('episodes').update(dbUpdates).eq('id', existing.id).eq('submitted_by', userId);
  let { error } = await write();
  // Taken between the check and the write (another episode sent in at the
  // same moment), under migration 118's unique index: once more, with the
  // next free number as it is now.
  if (error && returning && positionTaken(error)) {
    await takePlace();
    ({ error } = await write());
  }
  if (error) {
    if (positionTaken(error)) {
      return res.status(409).json({ error: 'Another episode took its number just now — try again.', code: 'taken' });
    }
    throw internalError(error, 'replace-video write');
  }

  // The old video has nothing pointing at it any more. Recorded only once
  // the new one is saved: it used to be recorded before the write, so a
  // failed save marked a video still in use as an orphan.
  const oldUid = cloudflareUidFromUrl(existing.src);
  if (oldUid && oldUid !== videoUid) {
    await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video replaced', context: existing.title });
  }

  const answer = { ok: true, episodeId: existing.id, resubmitted: Boolean(dbUpdates.status) };
  if (renumbered) {
    answer.renumbered = renumbered;
    answer.message = renumberedLine(renumbered);
  }
  return res.status(200).json(answer);
}
