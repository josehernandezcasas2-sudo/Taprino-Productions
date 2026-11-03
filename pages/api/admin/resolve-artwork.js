import { requireCapability } from '../../../lib/adminAuth';
import { getSupabase } from '../../../lib/supabase';
import { cloudflareUidFromUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { notifyCreator } from '../../../lib/notify';
import { invalidateCache } from '../../../lib/redis';
import { syncStreamProtection } from '../../../lib/streamProtection';
import { formatRuntime } from '../../../lib/videoMetadata';
import { getPlanRow, isMissingAdPlanTable } from '../../../lib/adPlans';
import { masterReady, masterState } from '../../../lib/showRules';
import { isTitleId } from '../../../lib/titleIds';
import { applyCors } from '../../../lib/cors';
import { internalError, sendError } from '../../../lib/apiErrors';

// An admin's decision on a staged change that waits for approval on a
// live title (the Library's queues; the series revamp's admin show page
// calls the same logic in slice 3).
//
//   POST { type: 'episode' | 'series', id, decision: 'approve' | 'deny',
//          part?: 'art' (default) | 'video', note? }
//
// part 'art' (manage_artwork): the staged poster / still — and on a show
// its hero image, title image (or its removal) and trailer. Approving puts
// them live and logs the replaced files as orphaned; denying logs the
// staged files instead. A show's new trailer is switched to signed links
// at once (decision 12).
//
// part 'video' (review_submissions — a new master is new content): an
// episode's staged replacement video, `episodes.pending_src` (migration
// 118; amendment 9 of the series revamp). The current video keeps playing
// until this. Approve is refused until Cloudflare says the new file is
// ready; then the new file plays, its runtime is the file's, a ready ad
// plan goes back to draft (its breaks were placed for the old file), and
// a title with captions is flagged "captions may be out of sync"
// (`captions_stale_at`) until new captions arrive or the flag is
// dismissed. Deny drops the staged file.
//
// Who is told: the uploader, as before, and now the show's owner
// (series.creator_id) when that's someone else — and for a show's own
// changes the owner, who was never told (show_edit_* / show_video_*,
// lib/notificationTypes.js), with the admin's note when there is one.
// The catalogue caches are cleared so the change shows at once.
const NOTE_MAX = 500;

function cleanNote(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}

function noteLine(note) {
  return note ? ` Note from the team: ${note}` : '';
}

const has = (v) => v !== null && v !== undefined && v !== '';

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The creator side of a show (Series management today; the show page
// once the series revamp's slice 2 ships, which forwards ?series= there).
function showHref(seriesId) {
  return `/creator/show/${encodeURIComponent(seriesId)}`;
}

async function readShow(supabase, seriesId) {
  if (!seriesId) return null;
  const { data, error } = await supabase.from('series').select('id, name, creator_id').eq('id', seriesId).maybeSingle();
  if (error) {
    console.error('resolve-artwork show:', error.message);
    return null;
  }
  return data || null;
}

// The uploader hears about their episode; the show's owner about anything
// in their show, once (an owner who uploaded it gets the uploader's one).
async function tell({ uploaderId, ownerId, episodeId = null, seriesId = null, uploader, owner }) {
  const jobs = [];
  if (uploaderId && uploader) jobs.push(notifyCreator({ userId: uploaderId, type: uploader.type, message: uploader.message, episodeId }));
  if (ownerId && owner && ownerId !== uploaderId) jobs.push(notifyCreator({ userId: ownerId, type: owner.type, message: owner.message, episodeId, href: seriesId ? showHref(seriesId) : null }));
  await Promise.all(jobs);
}

// Only the row as it was read is changed: a creator who staged something
// new in the meantime, or a second admin who got there first, makes this
// write match nothing (and the caller answer 409).
function whereUnchanged(query, row, columns) {
  let q = query;
  for (const c of columns) q = has(row[c]) || row[c] === false || row[c] === true ? q.eq(c, row[c]) : q.is(c, null);
  return q;
}

const EPISODE_ART = ['pending_poster', 'pending_thumbnail'];
const SERIES_ART = ['pending_poster', 'pending_thumbnail', 'pending_trailer_src', 'pending_hero_image', 'pending_title_image_url', 'pending_title_image_removal'];

function changed(res, line = 'That changed a moment ago. Reload the list and look again.') {
  return res.status(409).json({ error: line });
}

async function decideArt(res, { type, id, decision, note, userId, email }) {
  const supabase = getSupabase();
  const isEpisode = type === 'episode';
  const table = isEpisode ? 'episodes' : 'series';
  const selectCols = isEpisode
    ? 'title, poster, thumbnail, pending_poster, pending_thumbnail, submitted_by, series_id'
    : 'name, poster, thumbnail, trailer_src, hero_image, title_image_url, pending_poster, pending_thumbnail, pending_trailer_src, pending_hero_image, pending_title_image_url, pending_title_image_removal, creator_id';
  const { data: row, error: fetchError } = await supabase.from(table).select(selectCols).eq('id', id).maybeSingle();
  if (fetchError) throw internalError(fetchError, 'resolve-artwork read');
  if (!row) return res.status(404).json({ error: 'Not found.' });

  const context = isEpisode ? row.title : row.name;
  const parts = [];
  if (has(row.pending_poster)) parts.push('poster');
  if (has(row.pending_thumbnail)) parts.push('still');
  if (!isEpisode) {
    if (has(row.pending_hero_image)) parts.push('hero image');
    if (has(row.pending_title_image_url)) parts.push('title image');
    if (has(row.pending_trailer_src)) parts.push('trailer');
  }
  const removal = !isEpisode && row.pending_title_image_removal === true && !has(row.pending_title_image_url);
  if (parts.length === 0 && !removal) return changed(res, 'Nothing is waiting on this one any more. Reload the list.');

  const clearPending = { pending_poster: null, pending_thumbnail: null, ...(isEpisode ? {} : { pending_trailer_src: null, pending_hero_image: null, pending_title_image_url: null, pending_title_image_removal: false }) };
  const orphanJobs = [];
  const orphanImage = (url, reason) => {
    const path = storagePathFromUrl(url);
    if (path) orphanJobs.push({ kind: 'storage_image', reference: path, reason, context });
  };
  const orphanVideo = (url, reason) => {
    const uid = cloudflareUidFromUrl(url);
    if (uid) orphanJobs.push({ kind: 'cloudflare_video', reference: uid, reason, context });
  };

  let applyUpdates = clearPending;
  if (decision === 'deny') {
    // The staged uploads exist in storage/Cloudflare but will never be
    // used — logged for cleanup once the staging columns are cleared. The
    // live artwork is untouched.
    if (row.pending_poster) orphanImage(row.pending_poster, 'artwork change denied (poster)');
    if (row.pending_thumbnail) orphanImage(row.pending_thumbnail, 'artwork change denied (thumbnail)');
    if (!isEpisode && row.pending_trailer_src) orphanVideo(row.pending_trailer_src, 'trailer change denied');
    if (!isEpisode && row.pending_hero_image) orphanImage(row.pending_hero_image, 'hero image change denied');
    if (!isEpisode && row.pending_title_image_url) orphanImage(row.pending_title_image_url, 'title image change denied');
  } else {
    // Whatever was live before is about to be replaced: logged as orphaned
    // once the new artwork is in (only for slots actually changing).
    if (row.pending_poster && row.poster) orphanImage(row.poster, 'artwork change approved (old poster)');
    if (row.pending_thumbnail && row.thumbnail) orphanImage(row.thumbnail, 'artwork change approved (old thumbnail)');
    if (!isEpisode && row.pending_trailer_src && row.trailer_src) orphanVideo(row.trailer_src, 'trailer change approved (old trailer)');
    if (!isEpisode && row.pending_hero_image && row.hero_image) orphanImage(row.hero_image, 'hero image change approved (old hero image)');
    if (!isEpisode && row.pending_title_image_url && row.title_image_url) orphanImage(row.title_image_url, 'title image change approved (old title image)');
    if (removal && row.title_image_url) orphanImage(row.title_image_url, 'title image removal approved (reverted to text title)');
    applyUpdates = { ...clearPending };
    if (row.pending_poster) applyUpdates.poster = row.pending_poster;
    if (row.pending_thumbnail) applyUpdates.thumbnail = row.pending_thumbnail;
    if (!isEpisode && row.pending_trailer_src) applyUpdates.trailer_src = row.pending_trailer_src;
    if (!isEpisode && row.pending_hero_image) applyUpdates.hero_image = row.pending_hero_image;
    if (!isEpisode && row.pending_title_image_url) applyUpdates.title_image_url = row.pending_title_image_url;
    else if (removal) applyUpdates.title_image_url = null;
  }

  const { data: written, error } = await whereUnchanged(supabase.from(table).update(applyUpdates).eq('id', id), row, isEpisode ? EPISODE_ART : SERIES_ART).select('id');
  if (error) throw internalError(error, `resolve-artwork ${decision}`);
  if (!written || written.length === 0) return changed(res);

  await Promise.all(orphanJobs.map((job) => recordOrphan(job)));
  // A show's new trailer plays through signed links like everything else
  // (decision 12); the episode's own art carries no video.
  if (decision === 'approve' && !isEpisode && row.pending_trailer_src) await syncStreamProtection({ src: row.pending_trailer_src });
  // Episodes carry their show's artwork when they have none of their own,
  // so a show's change reaches the episode lists too.
  await Promise.all(isEpisode ? [invalidateCache('public_episodes_v1')] : [invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);

  const approved = decision === 'approve';
  await recordAudit({ adminId: userId, adminEmail: email, action: `${approved ? 'approve' : 'deny'}_${type}_artwork`, targetType: type, targetId: id, details: `${context || id}: ${[...parts, ...(removal ? ['title image removal'] : [])].join(', ')}${note ? ` · note: ${note}` : ''}` });

  if (isEpisode) {
    const show = await readShow(supabase, row.series_id);
    const inShow = show ? ` in "${show.name || 'your show'}"` : '';
    await tell({
      uploaderId: row.submitted_by,
      ownerId: show ? show.creator_id : null,
      episodeId: id,
      seriesId: show ? show.id : null,
      uploader: approved
        ? { type: 'artwork_approved', message: `Your artwork change for "${context}" was approved and is now live.` }
        : { type: 'artwork_denied', message: `Your artwork change for "${context}" was denied — the previous artwork is still in place.${noteLine(note)}` },
      owner: approved
        ? { type: 'show_edit_approved', message: `The new ${listWords(parts)} for "${context}"${inShow} ${parts.length === 1 ? 'was' : 'were'} approved and ${parts.length === 1 ? 'is' : 'are'} live.` }
        : { type: 'show_edit_denied', message: `The new ${listWords(parts)} for "${context}"${inShow} ${parts.length === 1 ? 'wasn’t' : 'weren’t'} approved, so the current artwork stays.${noteLine(note)}` }
    });
  } else {
    const name = `"${context || 'your show'}"`;
    let message;
    if (parts.length === 0) {
      message = approved ? `Removing the title image from ${name} was approved: the name shows as text again.` : `Removing the title image from ${name} wasn’t approved, so it stays.${noteLine(note)}`;
    } else if (approved) {
      message = `The new ${listWords(parts)} for ${name} ${parts.length === 1 ? 'was' : 'were'} approved and ${parts.length === 1 ? 'is' : 'are'} live${removal ? ', and the title image was removed' : ''}.`;
    } else {
      message = `The new ${listWords(parts)} for ${name} ${parts.length === 1 ? 'wasn’t' : 'weren’t'} approved, so what’s live stays.${noteLine(note)}`;
    }
    await tell({ ownerId: row.creator_id, seriesId: id, owner: { type: approved ? 'show_edit_approved' : 'show_edit_denied', message } });
  }

  return res.status(200).json({ ok: true, type, id, decision, part: 'art' });
}

// What stands in the way of approving a new video, in the admin's words.
function notReadyLine(state) {
  if (state === 'error') return 'The new video failed to process on Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'deleted') return 'The new video is gone from Cloudflare. Deny it, and the creator can upload it again.';
  if (state === 'uploading') return 'Not yet: the new video hasn’t finished uploading.';
  if (state === 'processing') return 'Not yet: Cloudflare is still processing the new video.';
  return 'Cloudflare didn’t say whether the new video is ready. Try again in a minute.';
}

async function decideVideo(res, { id, decision, note, userId, email }) {
  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase.from('episodes').select('title, src, pending_src, runtime, captions_url, submitted_by, series_id').eq('id', id).maybeSingle();
  // Before migration 118 there is no staged video to decide on.
  if (fetchError && isMissingColumn(fetchError)) return changed(res, 'There’s no new video waiting on this title.');
  if (fetchError) throw internalError(fetchError, 'resolve-artwork video read');
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (!has(row.pending_src)) return changed(res, 'There’s no new video waiting on this title.');

  const context = row.title;
  const newUid = cloudflareUidFromUrl(row.pending_src);
  const oldUid = cloudflareUidFromUrl(row.src);
  const approved = decision === 'approve';
  const now = new Date().toISOString();

  let status = null;
  let patch;
  let captionsFlagged = false;
  if (approved) {
    status = newUid ? await getCloudflareVideoStatus(newUid) : null;
    const state = masterState({ src: row.pending_src }, status);
    if (!masterReady({ src: row.pending_src }, status)) return res.status(409).json({ error: notReadyLine(state), videoState: state });
    patch = { src: row.pending_src, pending_src: null };
    // The runtime is the new file's (it may be longer or shorter).
    if (status && status.duration) patch.runtime = formatRuntime(status.duration);
    // Captions were timed to the old file.
    if (has(row.captions_url)) {
      patch.captions_stale_at = now;
      captionsFlagged = true;
    }
  } else {
    patch = { pending_src: null };
  }

  const write = (body) => supabase.from('episodes').update(body).eq('id', id).eq('pending_src', row.pending_src).select('id');
  let { data: written, error } = await write(patch);
  // captions_stale_at is a newer column than pending_src: without it the
  // video is still approved, just without the stored flag.
  if (error && captionsFlagged && /captions_stale_at/.test(error.message || '')) {
    const withoutFlag = { ...patch };
    delete withoutFlag.captions_stale_at;
    captionsFlagged = false;
    ({ data: written, error } = await write(withoutFlag));
  }
  if (error) throw internalError(error, `resolve-artwork video ${decision}`);
  if (!written || written.length === 0) return changed(res);

  const notices = [];
  let adPlanReset = false;
  if (approved) {
    // Signed links only, from the first play (decision 12).
    await syncStreamProtection({ src: row.pending_src });
    if (oldUid && oldUid !== newUid) await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video replaced (old master)', context });
    // A ready plan's breaks sit at seconds into the old file.
    try {
      const plan = await getPlanRow(id);
      if (plan && plan.status === 'ready') {
        const { data: reset, error: planError } = await supabase.from('episode_ad_plans').update({ status: 'draft', updated_by: userId, updated_at: now }).eq('episode_id', id).eq('status', 'ready').select('episode_id');
        if (planError) {
          if (!isMissingAdPlanTable(planError)) console.error('resolve-artwork ad plan:', planError.message);
        } else if (reset && reset.length > 0) {
          adPlanReset = true;
          notices.push('Its ad plan went back to draft: the breaks were placed for the old file. Check them in the Ad Curator before the plan is ready again.');
        }
      }
    } catch (err) {
      if (!isMissingAdPlanTable(err)) console.error('resolve-artwork ad plan:', err.message);
    }
    if (has(row.captions_url)) notices.push('Its captions were made for the old file and may be out of sync.');
  } else if (newUid && newUid !== oldUid) {
    await recordOrphan({ kind: 'cloudflare_video', reference: newUid, reason: 'new video denied', context });
  }
  await invalidateCache('public_episodes_v1');

  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: approved ? 'show_video_approved' : 'show_video_denied',
    targetType: 'episode',
    targetId: id,
    details: `${context || id}${approved && patch.runtime ? `: runtime ${patch.runtime}` : ''}${adPlanReset ? ' · ad plan back to draft' : ''}${approved && has(row.captions_url) ? ' · captions may be out of sync' : ''}${note ? ` · note: ${note}` : ''}`
  });

  const show = await readShow(supabase, row.series_id);
  const inShow = show ? ` in "${show.name || 'your show'}"` : '';
  const captionsWords = approved && has(row.captions_url) ? ' Its captions were made for the old file: check they still line up, or upload new ones.' : '';
  await tell({
    uploaderId: row.submitted_by,
    ownerId: show ? show.creator_id : null,
    episodeId: id,
    seriesId: show ? show.id : null,
    uploader: approved
      ? { type: 'show_video_approved', message: `The new video for "${context}" is live.${captionsWords}` }
      : { type: 'show_video_denied', message: `The new video for "${context}" wasn’t approved, so the current one keeps playing.${noteLine(note)}` },
    owner: approved
      ? { type: 'show_video_approved', message: `The new video for "${context}"${inShow} is live.${captionsWords}` }
      : { type: 'show_video_denied', message: `The new video for "${context}"${inShow} wasn’t approved, so the current one keeps playing.${noteLine(note)}` }
  });

  return res.status(200).json({
    ok: true,
    type: 'episode',
    id,
    decision,
    part: 'video',
    runtime: approved ? (patch.runtime || row.runtime || null) : null,
    adPlan: adPlanReset ? 'draft' : null,
    captionsMayBeOutOfSync: approved && has(row.captions_url),
    captionsFlagSaved: captionsFlagged,
    notices
  });
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const part = body.part === 'video' ? 'video' : 'art';
  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js). A new video for a
  // live title is a review decision, not an artwork one.
  const roleContext = await requireCapability(req, res, part === 'video' ? 'review_submissions' : 'manage_artwork');
  if (!roleContext) return undefined;
  const { userId, email } = roleContext;

  const { type, id, decision } = body;
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(String(id))) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }
  if (part === 'video' && type !== 'episode') {
    return res.status(400).json({ error: 'Only an episode has a new video to decide on.' });
  }
  if (body.part !== undefined && !['art', 'video'].includes(body.part)) {
    return res.status(400).json({ error: 'part must be "art" or "video".' });
  }
  const note = cleanNote(body.note);

  try {
    const args = { type, id: String(id), decision, note, userId, email };
    return part === 'video' ? await decideVideo(res, args) : await decideArt(res, args);
  } catch (err) {
    return sendError(res, err, 'admin/resolve-artwork', 'Could not resolve this change.');
  }
}
