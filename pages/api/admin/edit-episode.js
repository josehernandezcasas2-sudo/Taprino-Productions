import { requireCapability } from '../../../lib/adminAuth';
import { hasCapability } from '../../../lib/capabilities';
import { getSupabase } from '../../../lib/supabase';
import { uploadArtworkImage } from '../../../lib/artworkUpload';
import { normalizeUrl } from '../../../lib/normalizeUrl';
import { recordOrphan, storagePathFromUrl } from '../../../lib/orphanedMedia';
import { recordAudit } from '../../../lib/auditLog';
import { invalidateCache } from '../../../lib/redis';
import { notifyCreator } from '../../../lib/notify';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl, getCloudflareVideoStatus } from '../../../lib/cloudflareUpload';
import { syncStreamProtection } from '../../../lib/streamProtection';
import { internalError, sendError } from '../../../lib/apiErrors';
import { updateCompat } from '../../../lib/dbCompat';
import { isTitleId } from '../../../lib/titleIds';
import { VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { MAX_EPISODE_NUMBER, inRunningOrder, isPublicShow, masterState, payeeOf, slotCheck, slotTakenBody, titleRunnerOf } from '../../../lib/showRules';
import { syncNumberTitles } from '../../../lib/numberTitles';
import { cancelPendingInvites, noticeEarningsMoved, payeeRuleLiveNow, withPayeeStamps } from '../../../lib/payees';

// The Library's "Edit full details" (components/AdminEditEpisodeModal.js).
// Unlike pages/api/creator/edit-submission.js, this has no ownership
// check and no "must still be pending" restriction — an admin can fix or
// adjust anything in the library, including un-approving something that
// shouldn't have gone live (by setting status back to 'pending' or
// 'rejected') or toggling the homepage hero eligibility flag.
//
// The series revamp (2026-11-02) kept this route for the long tail and
// fixed it:
//   - a podcast episode keeps its show: the show, season and number are
//     cleared only for a film or a short (and bonus content, which hangs
//     off bonus_parent_*); a vertical title keeps whatever series it is in
//     (decision 17). It used to clear them for anything but 'series', so
//     every save of a podcast episode took it out of its show;
//   - bonus content is a type here too, with what it belongs under
//     (bonusParentType 'series' | 'episode' + bonusParentId), checked to
//     exist; the modal offered both and the route refused them;
//   - a show it's put into has to exist and take titles (not leaving, not
//     pulled), and its season and number can't be another episode's (409
//     with the holder and the next free number — a declined or withdrawn
//     episode holds none, amendment 6);
//   - only what actually changed is written and audited (the modal sent
//     every field on every save, so the audit line listed them all and
//     reviewed_at moved on every save; since 2026-11-03 it sends only the
//     fields the admin changed, and a missing key here means unchanged);
//   - a status change to approved is an approval (amendment 4, as decision
//     2 left it): released_at starts now, the video and the trailers
//     (the episode's and its show's) demand signed links, a Cloudflare
//     video still uploading, processing or failed is refused (amendment
//     3), a series or podcast episode needs its number; the show is never
//     made public by it — its owner or a full admin does that;
//   - a show with no other episode in its running order takes its kind
//     from the series or podcast episode saved into it (adoptShowKind
//     below), as manual-episode, submit-episode and rss-import do.
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

const VALID_TIERS = ['free', 'premium'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
const NUMBERED_TYPES = ['series', 'podcast'];
const BONUS_PARENT_TYPES = ['series', 'episode'];
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'status', 'featured', 'discoverCurated', 'availableFrom', 'availableUntil', 'adsEnabled', 'adBreakSeconds', 'contentType', 'seriesId', 'season', 'seriesOrder', 'rating', 'isOriginal', 'fundingUrl', 'audioUrl', 'releaseYear', 'bonusParentType', 'bonusParentId'];
const FIELD_TO_COLUMN = { mainGenre: 'main_genre', availableFrom: 'available_from', availableUntil: 'available_until', adsEnabled: 'ads_enabled', adBreakSeconds: 'ad_break_seconds', contentType: 'content_type', seriesId: 'series_id', seriesOrder: 'series_order', isOriginal: 'is_original', fundingUrl: 'funding_url', audioUrl: 'audio_url', releaseYear: 'release_year', discoverCurated: 'discover_curated', bonusParentType: 'bonus_parent_type', bonusParentId: 'bonus_parent_id' };
const BOOLEAN_FIELDS = ['featured', 'discoverCurated', 'isOriginal', 'adsEnabled'];
// What makes the slot check worth asking.
const PLACE_COLUMNS = ['series_id', 'season', 'series_order', 'status', 'content_type'];

function refuse(message, status = 400, extra = null) {
  return Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
}

function posInt(v) {
  if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function emptyish(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

// What the modal sent for one field, in the column's own terms; throws a
// 400 for a value the column can't take (which used to be a 500 from the
// database: NaN for a typed season, an unparseable date).
function columnValue(field, v) {
  switch (field) {
    case 'availableFrom':
    case 'availableUntil':
      // Date inputs send '' when cleared: "remove this date".
      if (emptyish(v)) return null;
      if (!Number.isFinite(Date.parse(String(v)))) throw refuse('That date doesn’t read as a date.');
      return String(v);
    case 'season':
      if (emptyish(v)) return null;
      if (!posInt(v)) throw refuse('Seasons are numbered from 1.');
      return posInt(v);
    case 'seriesOrder': {
      if (emptyish(v)) return null;
      const n = posInt(v);
      if (!n || n > MAX_EPISODE_NUMBER) throw refuse(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
      return n;
    }
    case 'releaseYear': {
      const year = Number(v);
      return emptyish(v) || !Number.isInteger(year) ? null : year;
    }
    case 'fundingUrl':
      return normalizeUrl(typeof v === 'string' ? v : '');
    case 'rating':
    case 'audioUrl':
      return emptyish(v) ? null : String(v).trim();
    case 'seriesId': {
      if (emptyish(v)) return null;
      const id = String(v).trim();
      if (id === '__new__') throw refuse('Pick a show from the list: a new one is made from the show page, not here.');
      if (!isTitleId(id)) throw refuse('That show isn’t there any more — pick another.');
      return id;
    }
    case 'bonusParentType':
      if (emptyish(v)) return null;
      if (!BONUS_PARENT_TYPES.includes(v)) throw refuse('Bonus content belongs under a show or a title.');
      return v;
    case 'bonusParentId':
      if (emptyish(v)) return null;
      if (!isTitleId(String(v))) throw refuse('Choose which series or movie/short this bonus content belongs under.');
      return String(v);
    case 'adBreakSeconds': {
      if (!Array.isArray(v)) throw refuse('Ad breaks are a list of times.');
      const list = v.map(Number);
      if (list.some((n) => !Number.isFinite(n) || n < 0)) throw refuse('Ad breaks are times from 0:00.');
      return list;
    }
    default:
      if (BOOLEAN_FIELDS.includes(field)) return v === true || v === 'true';
      return typeof v === 'string' ? v : String(v ?? '');
  }
}

// Whether a column's new value is what the row already has.
function sameValue(column, a, b) {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (column === 'available_from' || column === 'available_until') {
    if (x === null || y === null) return x === y;
    return Date.parse(String(x)) === Date.parse(String(y));
  }
  if (column === 'ad_break_seconds') return JSON.stringify((x || []).map(Number)) === JSON.stringify((y || []).map(Number));
  if (typeof x === 'boolean' || typeof y === 'boolean') return Boolean(x) === Boolean(y);
  if (typeof x === 'number' || typeof y === 'number') return x !== null && y !== null ? Number(x) === Number(y) : x === y;
  return x === y;
}

// A show with no episode in its running order but this one takes this
// one's kind, by manual-episode's rule: migration 118's series.kind
// decides whether /series/<id> sends its viewers on to /podcasts/<id>, and
// a show made through "Add series" (which sends no kind) reads as a
// series, so a podcast episode moved into it — or a lone episode retyped
// inside it — would otherwise keep rendering as a series. The column has
// to be on the row (118 run); a vertical (Snippet) series, and a show that
// has other episodes, keep their kind. Best effort, after the episode is
// saved: a failed read or write is logged, never the admin's problem.
// → the kind the show now has, or null when it kept its own.
async function adoptShowKind(supabase, show, episodeId, type) {
  if (!show || !Object.prototype.hasOwnProperty.call(show, 'kind')) return null;
  if (!NUMBERED_TYPES.includes(show.kind) || !NUMBERED_TYPES.includes(type) || show.kind === type) return null;
  const { data: rows, error } = await supabase.from('episodes').select('id, status, content_type, withdrawn_at').eq('series_id', show.id);
  if (error) {
    console.error('admin/edit-episode show kind (episodes):', error.message);
    return null;
  }
  if ((rows || []).some((r) => r.id !== episodeId && inRunningOrder(r) && NUMBERED_TYPES.includes(r.content_type))) return null;
  const { error: kindError } = await supabase.from('series').update({ kind: type }).eq('id', show.id);
  if (kindError) {
    console.error('admin/edit-episode show kind:', kindError.message);
    return null;
  }
  return type;
}

async function slotRefusal(supabase, next, episodeId) {
  const { data: rows, error } = await supabase.from('episodes').select('id, title, season, series_order, status, content_type, withdrawn_at, created_at').eq('series_id', next.series_id);
  if (error) throw internalError(error, 'edit-episode slots');
  const season = next.season || 1;
  const slot = slotCheck(rows || [], { season, number: next.series_order, excludeId: episodeId });
  if (slot.free) return null;
  const { error: message, ...extra } = slotTakenBody(slot);
  return refuse(message, 409, extra);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Full admins pass; a sub-admin needs the same capability the page that
  // calls this route is gated on (lib/adminAuth.js).
  const roleContext = await requireCapability(req, res, 'manage_episodes');
  if (!roleContext) return;

  try {
    return await editEpisode(req, res, roleContext);
  } catch (err) {
    if (err && err.extra) return res.status(err.status).json({ error: err.message, ...err.extra });
    return sendError(res, err, 'admin/edit-episode', 'Could not save changes.');
  }
}

async function editEpisode(req, res, roleContext) {
  const { userId, email } = roleContext;
  const { episodeId, posterBase64, posterFileName, thumbnailBase64, thumbnailFileName, titleImageBase64, titleImageFileName, removeTitleImage, cloudflareVideoUid, ...fields } = req.body || {};
  if (!episodeId || !isTitleId(String(episodeId))) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase.from('episodes').select('*').eq('id', String(episodeId)).maybeSingle();
  if (fetchError) throw internalError(fetchError, 'edit-episode read');
  if (!existing) return res.status(404).json({ error: 'Episode not found.' });

  if (fields.tier !== undefined && !VALID_TIERS.includes(fields.tier)) {
    return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (fields.status !== undefined && !VALID_STATUSES.includes(fields.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  // Publishing or unpublishing is the review capability's call, not
  // metadata's (security round 2, 2026-10-28): a sub-admin with
  // manage_episodes alone could set status: approved here.
  if (fields.status !== undefined && fields.status !== existing.status && !hasCapability(roleContext, 'review_submissions')) {
    return res.status(403).json({ error: 'Changing a title’s status needs the review capability.' });
  }
  if (fields.contentType !== undefined && !VALID_CONTENT_TYPES.includes(fields.contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` });
  }
  if (cloudflareVideoUid && !VIDEO_UID_PATTERN.test(String(cloudflareVideoUid))) {
    return res.status(400).json({ error: 'That doesn’t look like a Cloudflare video ID — copy it again from the Stream dashboard.' });
  }

  // What was sent, in the columns' terms.
  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (fields[f] === undefined) continue;
    updates[FIELD_TO_COLUMN[f] || f] = columnValue(f, fields[f]);
  }

  // The row as it would be, and what its type means for its place.
  const next = { ...existing, ...updates };
  const type = next.content_type;
  if (NUMBERED_TYPES.includes(type)) {
    if (!next.series_id) {
      return res.status(400).json({ error: type === 'podcast' ? 'A podcast episode needs its show — pick one.' : 'A series must be selected when content type is "series".' });
    }
    if (next.season === null || next.season === undefined) updates.season = 1;
    updates.bonus_parent_type = null;
    updates.bonus_parent_id = null;
  } else if (type === 'vertical') {
    // Vertical (Snippet) series are left as they are (decision 17): a
    // vertical title keeps the series it's in; one in none takes no season
    // or number (the modal sends its season box's "1" on every save).
    if (!next.series_id) {
      updates.season = null;
      updates.series_order = null;
    }
    updates.bonus_parent_type = null;
    updates.bonus_parent_id = null;
  } else if (type === 'bonus') {
    updates.series_id = null;
    updates.season = null;
    updates.series_order = null;
    if (!next.bonus_parent_type || !next.bonus_parent_id) {
      return res.status(400).json({ error: 'Choose which series or movie/short this bonus content belongs under.' });
    }
    if (next.bonus_parent_type === 'episode' && next.bonus_parent_id === existing.id) {
      return res.status(400).json({ error: 'Bonus content can’t belong under itself.' });
    }
  } else {
    // A film or a short sits in no show.
    updates.series_id = null;
    updates.season = null;
    updates.series_order = null;
    updates.bonus_parent_type = null;
    updates.bonus_parent_id = null;
  }
  Object.assign(next, updates);

  // Only what actually changes.
  const changed = {};
  for (const [column, value] of Object.entries(updates)) {
    if (!sameValue(column, value, existing[column])) changed[column] = value;
  }

  // The show it goes into: there, and taking titles.
  let targetShow = null;
  if (changed.series_id) {
    const { data, error } = await supabase.from('series').select('*').eq('id', changed.series_id).maybeSingle();
    if (error) throw internalError(error, 'edit-episode show');
    if (!data) return res.status(400).json({ error: 'That show isn’t there any more — pick another.' });
    if (data.deletion_requested) return res.status(400).json({ error: 'That show’s removal is requested — pick another.' });
    if (data.moderation_hold) return res.status(400).json({ error: 'That show is pulled while it’s looked at — restore it first, or pick another.' });
    targetShow = data;
  }

  // Since slice 3b, putting a title in another show (or out of one) can
  // change who it pays (lib/showRules.js payeeOf). Moving money is for full
  // admins: a sub-admin's edit that would is refused before anything is
  // written; one that leaves it paying the same account goes on (before
  // migration 118, which brings paid_to, every lane pays the old rule).
  if ('series_id' in changed && !roleContext.isAdmin && 'paid_to' in existing && payeeRuleLiveNow()) {
    let showNow = null;
    if (existing.series_id && isTitleId(String(existing.series_id))) {
      const { data, error } = await supabase.from('series').select('*').eq('id', existing.series_id).maybeSingle();
      if (error) throw internalError(error, 'edit-episode show before');
      showNow = data || null;
    }
    if (payeeOf(existing, showNow) !== payeeOf({ ...existing, series_id: changed.series_id || null }, targetShow)) {
      return res.status(403).json({ error: 'That moves its earnings to another account. A full admin does this.', code: 'who' });
    }
  }

  // What bonus content belongs under: there, and not bonus content itself.
  if (type === 'bonus' && ('bonus_parent_type' in changed || 'bonus_parent_id' in changed || 'content_type' in changed)) {
    const parentIsShow = next.bonus_parent_type === 'series';
    const { data: parent, error } = parentIsShow
      ? await supabase.from('series').select('id').eq('id', next.bonus_parent_id).maybeSingle()
      : await supabase.from('episodes').select('id, content_type').eq('id', next.bonus_parent_id).maybeSingle();
    if (error) throw internalError(error, 'edit-episode bonus parent');
    if (!parent) return res.status(400).json({ error: 'That isn’t there any more — pick what this bonus content belongs under again.' });
    if (!parentIsShow && parent.content_type === 'bonus') return res.status(400).json({ error: 'Bonus content goes under a show or a title, not under other bonus content.' });
  }

  // Manual video replacement — the fallback for when a creator's in-app
  // upload keeps failing: the file gets uploaded directly through
  // Cloudflare's own dashboard, and this just links the resulting video ID
  // to the episode. Same integrity check as manual-episode.js: Cloudflare's
  // own transcoding has to have actually succeeded before this gets wired in.
  let newSrc;
  let newVideoStatus = null;
  if (cloudflareVideoUid) {
    newVideoStatus = await getCloudflareVideoStatus(cloudflareVideoUid);
    if (!newVideoStatus) {
      return res.status(404).json({ error: 'No Cloudflare video found with that ID.' });
    }
    if (newVideoStatus.state === 'error') {
      return res.status(400).json({ error: `Cloudflare could not process this video: ${newVideoStatus.errorReasonText || newVideoStatus.errorReasonCode}.` });
    }
    newSrc = cloudflarePlaybackUrl(cloudflareVideoUid);
    if (newSrc === existing.src) newSrc = undefined;
  }

  // An approval (the status select): a series or podcast episode needs its
  // number, and a Cloudflare video Cloudflare says is still uploading,
  // processing or failed waits (amendment 3; "unknown" doesn't block).
  const approving = changed.status === 'approved';
  if (approving && NUMBERED_TYPES.includes(type) && !next.series_order) {
    return res.status(409).json({ error: 'Give it an episode number before approving it.', code: 'unnumbered' });
  }
  if (approving) {
    const playing = newSrc || existing.src || '';
    const uid = cloudflareUidFromUrl(playing);
    if (uid) {
      const state = masterState({ ...existing, src: playing }, newSrc ? newVideoStatus : await getCloudflareVideoStatus(uid));
      if (['uploading', 'processing', 'error', 'deleted'].includes(state)) {
        const why = state === 'uploading' ? 'the video is still uploading' : state === 'processing' ? 'Cloudflare is still processing the video' : 'Cloudflare could not process the video — replace it first';
        return res.status(409).json({ error: `Not yet: ${why}.`, code: 'master-not-ready' });
      }
    }
  }

  // Its place can't be another episode's (a declined or withdrawn one
  // holds none). Before migration 118's unique index this is the only
  // thing that stops two S1 E3s; after it, the index backs it up.
  // A season left empty plays as Season 1 (lib/showRules.js seasonOf), so
  // the 1 written into it above is not a move: a title-only save of such a
  // row (from before 118 filled the seasons in) isn't refused over a
  // number it already had.
  const holdsSlot = NUMBERED_TYPES.includes(type) && next.series_id && next.series_order && next.status !== 'rejected' && !next.withdrawn_at;
  const placeChanged = PLACE_COLUMNS.some((c) => c in changed && !(c === 'season' && (posInt(changed.season) || 1) === (posInt(existing.season) || 1)));
  if (holdsSlot && placeChanged) {
    const taken = await slotRefusal(supabase, next, existing.id);
    if (taken) throw taken;
  }

  let poster;
  let thumbnail;
  let titleImageUrl;
  try {
    [poster, thumbnail, titleImageUrl] = await Promise.all([
      uploadArtworkImage({ base64: posterBase64, fileName: posterFileName, pathPrefix: `${existing.id}-poster` }),
      uploadArtworkImage({ base64: thumbnailBase64, fileName: thumbnailFileName, pathPrefix: `${existing.id}-thumbnail` }),
      uploadArtworkImage({ base64: titleImageBase64, fileName: titleImageFileName, pathPrefix: `${existing.id}-title-image` })
    ]);
  } catch (err) {
    // A storage failure is marked internal (lib/artworkUpload.js) and
    // answered plainly; a file that's too big or not an image is a line
    // for the admin.
    if (err && err.internal) throw err;
    return res.status(400).json({ error: (err && err.message) || 'Could not store the artwork.' });
  }

  const dbUpdates = { ...changed };
  const now = new Date().toISOString();
  // A status change here is a deliberate decision outside the review
  // queue: stamp who and when (reviewed_by is the user id, as the queue
  // writes it), and an approval is the release (early screenings and the
  // "New episode" banner start now).
  if (changed.status) {
    dbUpdates.reviewed_at = now;
    dbUpdates.reviewed_by = userId;
    if (approving) dbUpdates.released_at = now;
  }
  if (poster) dbUpdates.poster = poster;
  if (thumbnail) dbUpdates.thumbnail = thumbnail;
  if (titleImageUrl) dbUpdates.title_image_url = titleImageUrl;
  else if (removeTitleImage && existing.title_image_url) dbUpdates.title_image_url = null;
  if (newSrc) dbUpdates.src = newSrc;

  // Nothing to write: a save with no change answers as one.
  if (Object.keys(dbUpdates).length === 0) {
    return res.status(200).json({ ok: true, episodeId: existing.id, changed: [] });
  }

  // A move to another show (or out of one) can change who the title pays
  // (lib/showRules.js payeeOf): its history is written with the save
  // (lib/payees.js, slice 3b). The write's own error is answered below.
  const movesShow = 'series_id' in changed;
  let writeResult = null;
  const doWrite = async () => {
    writeResult = await updateCompat(supabase, 'episodes', dbUpdates, ['released_at'], (q) => q.eq('id', existing.id));
    if (writeResult.error) throw Object.assign(new Error('edit-episode write'), { editWriteFailed: true });
  };
  let stamped = null;
  if (movesShow) {
    try {
      stamped = await withPayeeStamps({ scope: { episodeIds: [existing.id] }, patch: { episodes: { [existing.id]: { series_id: changed.series_id || null } } }, write: doWrite, setBy: `edit:${userId}` });
    } catch (err) {
      if (!(err && err.editWriteFailed)) throw err;
    }
  } else {
    try {
      await doWrite();
    } catch (err) {
      if (!(err && err.editWriteFailed)) throw err;
    }
  }
  const { error } = writeResult || {};
  if (error) {
    for (const url of [poster, thumbnail, titleImageUrl]) {
      const path = storagePathFromUrl(url || '');
      if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason: 'admin edit failed', context: existing.title });
    }
    // Taken a moment ago, under migration 118's unique index.
    if (error.code === '23505' && /episodes_show_position_uq/.test(error.message || '')) {
      const taken = await slotRefusal(supabase, next, existing.id);
      if (taken) throw taken;
      return res.status(409).json({ error: 'That number was just taken — reload and pick another.', code: 'taken' });
    }
    throw internalError(error, 'edit-episode write');
  }

  // The files this save replaced, recorded only once it's saved (they
  // used to be recorded before the write, so a failed save marked files
  // still in use as orphans).
  const titleImageRemoved = !titleImageUrl && dbUpdates.title_image_url === null;
  const replaced = [
    { gone: Boolean(poster) && existing.poster, reason: 'artwork replaced by admin (poster)' },
    { gone: Boolean(thumbnail) && existing.thumbnail, reason: 'artwork replaced by admin (thumbnail)' },
    { gone: (Boolean(titleImageUrl) || titleImageRemoved) && existing.title_image_url, reason: titleImageRemoved ? 'title image removed by admin (reverted to text title)' : 'artwork replaced by admin (title image)' }
  ];
  for (const { gone, reason } of replaced) {
    const oldPath = gone ? storagePathFromUrl(gone) : null;
    if (oldPath) await recordOrphan({ kind: 'storage_image', reference: oldPath, reason, context: existing.title });
  }
  if (newSrc) {
    const oldUid = cloudflareUidFromUrl(existing.src);
    if (oldUid && oldUid !== cloudflareVideoUid) {
      await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video manually replaced by admin', context: existing.title });
    }
  }

  // Whoever it paid until now is told, as a pick would tell them.
  if (stamped && stamped.changed && stamped.changed.length) {
    await noticeEarningsMoved({ changed: stamped.changed, viewer: { userId, email }, how: 'moved' }).catch((err) => console.error('edit-episode earnings notice:', err && err.message));
  }

  // A new runner didn't send its invites and prices it from now on.
  if (movesShow) {
    let showBefore = null;
    if (existing.series_id) {
      const { data } = await supabase.from('series').select('creator_id').eq('id', existing.series_id).maybeSingle();
      showBefore = data || null;
    }
    const runnerBefore = titleRunnerOf(existing, showBefore);
    const runnerAfter = titleRunnerOf(existing, targetShow);
    if (runnerBefore !== runnerAfter) {
      await cancelPendingInvites({ titles: [{ type: 'episode', id: existing.id }], reason: 'runner', actor: { userId, email, isAdmin: true } })
        .catch((err) => console.error('edit-episode invites:', err && err.message));
      if (runnerAfter) {
        const { error: priceError } = await supabase.from('title_prices').update({ creator_id: runnerAfter }).eq('target_type', 'episode').eq('target_id', existing.id);
        if (priceError && !/title_prices|PGRST205|does not exist/i.test(priceError.message || '')) console.error('edit-episode price owner:', priceError.message);
      }
    }
  }

  // The show it's in, read once for what follows: the trailer an approval
  // protects, and the kind a series or podcast episode gives a show that
  // has no other (a moved episode's show was read above).
  const numbered = NUMBERED_TYPES.includes(type);
  let showRow = targetShow;
  if (!showRow && next.series_id && (approving || numbered)) {
    const { data } = await supabase.from('series').select('*').eq('id', next.series_id).maybeSingle();
    showRow = data || null;
  }
  const kindTaken = numbered ? await adoptShowKind(supabase, showRow, existing.id, type) : null;
  // A title that is only its number follows a new number (lib/numberTitles.js).
  if (placeChanged || 'title' in changed) await syncNumberTitles([existing.id]);

  // Every Cloudflare video the site plays demands a signed link: a new
  // video, a tier decided, and an approval — which covers the trailers
  // too, the episode's and its show's (decision 12). Best effort.
  const src = newSrc || existing.src;
  const protect = [];
  if (changed.tier !== undefined || newSrc || approving) protect.push(src);
  if (approving) {
    protect.push(existing.trailer_src);
    if (showRow) protect.push(showRow.trailer_src);
  }
  await Promise.all([...new Set(protect.filter(Boolean))].map((s) => syncStreamProtection({ src: s })));

  await invalidateCache('public_episodes_v1');
  if ('series_id' in changed || kindTaken) await invalidateCache('all_series_approved_v1');

  const columns = Object.keys(dbUpdates).filter((c) => !['reviewed_at', 'reviewed_by', 'released_at'].includes(c));
  const moved = 'series_id' in changed ? ` · moved from ${existing.series_id || 'no show'} to ${changed.series_id || 'no show'}` : '';
  const retyped = kindTaken ? ` · ${showRow.id} is now a ${kindTaken} show` : '';
  await recordAudit({
    adminId: userId,
    adminEmail: email,
    action: 'edit_episode',
    targetType: 'episode',
    targetId: existing.id,
    details: `${existing.title} — changed: ${columns.join(', ') || 'nothing'}${moved}${retyped}`
  });

  // A status override outside the normal review flow (e.g. un-approving
  // something) is worth telling the creator about — everything else here
  // (title tweaks, tier, artwork) is routine housekeeping, not something
  // that needs its own notification.
  if (changed.status) {
    await notifyCreator({
      userId: existing.submitted_by,
      type: 'status_changed_by_admin',
      message: `An admin changed "${existing.title}"'s status to ${changed.status}.`,
      episodeId: existing.id
    });
  }

  // A move into a show someone else runs: before the cut-over its earnings
  // stayed with the uploader; from it they follow the show's paid account
  // (slice 3b) unless the title has its own.
  const answer = { ok: true, episodeId: existing.id, changed: columns };
  if (targetShow && targetShow.creator_id && targetShow.creator_id !== existing.submitted_by) {
    answer.showOwner = targetShow.creator_id;
  }
  // An approved title in a show that isn't public stays off the site until
  // the show is made public (decision 2): said when it's approved or moved.
  if ((approving || targetShow) && next.status === 'approved' && numbered && showRow && !isPublicShow(showRow)) {
    answer.showNote = `${showRow.name || 'The show'} isn’t public yet: this episode shows once its owner or a full admin makes it public.`;
  }
  // The show took this episode's kind (adoptShowKind).
  if (kindTaken) answer.showKind = kindTaken;
  return res.status(200).json(answer);
}
