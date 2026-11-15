import { requireCapability } from '../../../lib/adminAuth';
import { episodeOwnerIds } from '../../../lib/titleOwners';
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
import { VIDEO_UID_PATTERN, checkVideoOwnership } from '../../../lib/videoOwnership';
import { FILE_REVIEW_LINE, OWN_WORK_LINE, approvesOwnWork } from '../../../lib/titleSecurityRules';
import { checkAudioAddress } from '../../../lib/audioAddress';
import { MAX_EPISODE_NUMBER, OWN_TITLE_LINE, fieldPolicy, fieldPolicyLine, flashingLightsChange, inRunningOrder, ownTeamCtx, isPublicShow, masterState, payeeOf, slotCheck, slotTakenBody, titleRunnerOf } from '../../../lib/showRules';
import { LIVE_REVIEW_124_MSG, nextPendingFields, pendingFieldsOf } from '../../../lib/liveReviewRules';
import { syncNumberTitles } from '../../../lib/numberTitles';
import { normalizeExtraKind } from '../../../lib/extraKinds';
import { anchoredExtras, cancelPendingInvites, noticeEarningsMoved, payeeRuleLiveNow, payeeShowIds, withPayeeStamps } from '../../../lib/payees';
import { wellFormedBody } from '../../../lib/wellFormed';
import { MIGRATION_123_MSG } from '../../../lib/downloadSiteRules';

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
const EDITABLE_FIELDS = ['title', 'description', 'artist', 'runtime', 'genre', 'mainGenre', 'tier', 'status', 'featured', 'discoverCurated', 'availableFrom', 'availableUntil', 'adsEnabled', 'adBreakSeconds', 'contentType', 'seriesId', 'season', 'seriesOrder', 'rating', 'isOriginal', 'hasFlashingLights', 'fundingUrl', 'audioUrl', 'releaseYear', 'bonusParentType', 'bonusParentId'];
const FIELD_TO_COLUMN = { mainGenre: 'main_genre', availableFrom: 'available_from', availableUntil: 'available_until', adsEnabled: 'ads_enabled', adBreakSeconds: 'ad_break_seconds', contentType: 'content_type', seriesId: 'series_id', seriesOrder: 'series_order', isOriginal: 'is_original', hasFlashingLights: 'has_flashing_lights', fundingUrl: 'funding_url', audioUrl: 'audio_url', releaseYear: 'release_year', discoverCurated: 'discover_curated', bonusParentType: 'bonus_parent_type', bonusParentId: 'bonus_parent_id' };
const BOOLEAN_FIELDS = ['featured', 'discoverCurated', 'isOriginal', 'hasFlashingLights', 'adsEnabled'];
// What makes the slot check worth asking.
const PLACE_COLUMNS = ['series_id', 'season', 'series_order', 'status', 'content_type'];
// lib/showPage.js updateEpisode's limit for an episode's page notes.
const PAGE_NOTES_MAX = 4000;

// Every change to a live title is reviewed (Jose, 2026-11-15: "make sure
// any caption change or anything to change the series/live titles needs
// review"; lib/showRules.js ownTeamTitle / teamLiveMode). This route is the
// team's, so a full admin's save applies at once as before. Anyone else's,
// on a title that isn't in review, is decided field by field by the same
// policy the show editor runs:
//   - their own title (they uploaded it, or run its show:
//     lib/titleOwners.js episodeOwnerIds) goes the owner's way — what an
//     owner's change waits for waits (the details in migration 124's
//     pending_fields; the title, description and notes, art and a new file
//     in their pending_* columns), and what an owner can't change at all
//     (Who can watch, the rating, the status, the dates…) is refused with
//     OWN_TITLE_LINE;
//   - someone else's live title: a field that waits on a live title applies
//     at once only for a reviewer (review_submissions) and is refused
//     otherwise; a new file is the caller's own upload, so it waits for
//     another reviewer (pending_src); Who can watch, the rating, the
//     status, the place and the switches stay the team's.
// The columns that can wait, by the field policy's name and where they wait.
const STAGEABLE = {
  title: { field: 'title', pending: 'pending_title' },
  description: { field: 'description', pending: 'pending_description' },
  page_notes: { field: 'pageNotes', pending: 'pending_page_notes', needs: 'pending_page_notes', needsMsg: 'Notes need a database update (migration 122).', code: 'migration-122' },
  main_genre: { field: 'mainGenre', detail: true },
  genre: { field: 'genre', detail: true },
  artist: { field: 'artist', detail: true },
  release_year: { field: 'releaseYear', detail: true },
  runtime: { field: 'runtime', detail: true },
  funding_url: { field: 'fundingUrl', detail: true },
  ad_break_seconds: { field: 'adBreakSeconds', detail: true },
  ads_enabled: { field: 'adsEnabled', detail: true },
  extra_kind: { field: 'extraKind', detail: true },
  poster: { field: 'poster', pending: 'pending_poster' },
  thumbnail: { field: 'thumbnail', pending: 'pending_thumbnail' },
  title_image_url: { field: 'titleImage', pending: 'pending_title_image_url', needs: 'pending_title_image_url', needsMsg: 'Changing a live episode’s title image or trailer needs a database update (migration 120).', code: 'migration-120' },
  src: { field: 'video', pending: 'pending_src', needs: 'pending_src', needsMsg: 'Replacing a live episode’s file needs a database update (migration 118).', code: 'migration-118' }
};

// The rest of what this route writes, by the field policy's name, for a
// team member's own title (the owner's way): a column that isn't here, or
// in STAGEABLE, is nothing an owner changes (the status, the type, the
// dates, the audio address, the Discover pick) and is refused.
const OWNER_FIELDS = {
  tier: 'tier',
  rating: 'rating',
  is_original: 'isOriginal',
  featured: 'featured',
  has_flashing_lights: 'hasFlashingLights',
  downloads_allowed: 'downloadsAllowed',
  series_id: 'seriesId',
  season: 'season',
  series_order: 'seriesOrder',
  bonus_parent_type: 'bonusParent',
  bonus_parent_id: 'bonusParent'
};

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
  // A lone surrogate in any text would make Postgres refuse the save
  // (a 500): every string in the body is made well formed first.
  wellFormedBody(req);
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
  // The notes for the title's own page (migration 118's page_notes; the
  // show editor's limits: 4,000 characters, blank lines make paragraphs).
  // The row is read whole above, so a database before 118 has no such key:
  // the modal hides the box then, and a save that sends notes anyway is
  // told why rather than failing on the column.
  if (fields.pageNotes !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(existing, 'page_notes')) {
      return res.status(503).json({ error: 'Notes need a database update (migration 118).', code: 'migration-118' });
    }
    const notes = typeof fields.pageNotes === 'string' ? fields.pageNotes.trim() : '';
    if (notes.length > PAGE_NOTES_MAX) return res.status(400).json({ error: 'The notes are limited to 4,000 characters.' });
    updates.page_notes = notes || null;
  }

  // The creator's switch "Allow downloads in the app" (migration 123;
  // lib/downloadRules.js), which the team may set for any title. Before
  // 123 the row has no such column and the save is told why.
  if (fields.downloadsAllowed !== undefined) {
    if (typeof fields.downloadsAllowed !== 'boolean') return res.status(400).json({ error: 'Say whether it can be downloaded in the app.' });
    if (!Object.prototype.hasOwnProperty.call(existing, 'downloads_allowed')) {
      return res.status(503).json({ error: MIGRATION_123_MSG, code: 'migration-123' });
    }
    updates.downloads_allowed = fields.downloadsAllowed;
  }

  // What kind of extra (migration 121, lib/extraKinds.js), cleaned; only
  // for a title that is (or becomes) bonus content, and only where the
  // database has the column (select('*') above carries it), so a save
  // before 121 simply leaves it out.
  const typeAfter = fields.contentType !== undefined ? fields.contentType : existing.content_type;
  if (fields.extraKind !== undefined && typeAfter === 'bonus' && Object.prototype.hasOwnProperty.call(existing, 'extra_kind')) {
    if (fields.extraKind !== null && typeof fields.extraKind !== 'string') return res.status(400).json({ error: 'What kind of extra is it?' });
    updates.extra_kind = normalizeExtraKind(fields.extraKind);
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

  // A podcast's audio: a sub-admin sets one of our own stored files, the
  // title's uploader's or their own, that no other title uses — never an
  // address typed in (lib/audioAddress.js; 2026-11-15). A full admin may
  // link audio hosted elsewhere.
  if ('audio_url' in changed && changed.audio_url && !roleContext.isAdmin) {
    const audio = await checkAudioAddress(changed.audio_url, { owners: [userId, existing.submitted_by], selfId: existing.id });
    if (!audio.ok) return res.status(audio.status).json({ error: audio.error, code: 'audio' });
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

  // The show its money follows before and after the save (lib/showRules.js
  // payeeShowIdOf: its series_id, or an extra's show through
  // bonus_parent_*), and the extras filed under it, which follow it to
  // another show (Jose, 2026-11-06: extras follow their show).
  // The extras filed after an episode follow its series_id (payeeShowIdOf
  // reads the parent's), which can change while the show its own money
  // follows doesn't: re-filed as an extra of the same show, it leaves them
  // none. So they're compared on their own: their show before and after.
  let affectsPayee = false;
  let showBefore = null;
  let showAfter = null;
  let followingExtras = [];
  let extrasShowBefore = null;
  let extrasShowAfter = null;
  if (['series_id', 'bonus_parent_type', 'bonus_parent_id', 'content_type'].some((c) => c in changed)) {
    const [before, after] = await Promise.all([payeeShowIds([existing]), payeeShowIds([next])]);
    const sidBefore = before.get(existing.id) || null;
    const sidAfter = after.get(existing.id) || null;
    const extrasSidBefore = existing.content_type !== 'bonus' ? existing.series_id || null : null;
    const extrasSidAfter = existing.content_type !== 'bonus' ? next.series_id || null : null;
    if (existing.content_type !== 'bonus' && extrasSidBefore !== extrasSidAfter) followingExtras = await anchoredExtras({ episodeIds: [existing.id] });
    affectsPayee = sidBefore !== sidAfter || followingExtras.length > 0;
    if (affectsPayee) {
      const shows = new Map();
      const readShow = async (sid) => {
        if (!sid || !isTitleId(String(sid))) return null;
        if (targetShow && targetShow.id === sid) return targetShow;
        if (!shows.has(sid)) {
          shows.set(sid, supabase.from('series').select('*').eq('id', sid).maybeSingle().then(({ data, error }) => {
            if (error) throw internalError(error, 'edit-episode show before');
            return data || null;
          }));
        }
        return shows.get(sid);
      };
      [showBefore, showAfter, extrasShowBefore, extrasShowAfter] = await Promise.all([readShow(sidBefore), readShow(sidAfter), readShow(extrasSidBefore), readShow(extrasSidAfter)]);
    }
  }

  // Since slice 3b, putting a title in another show (or out of one) can
  // change who it pays (lib/showRules.js payeeOf), and who its extras pay.
  // Moving money is for full admins: a sub-admin's edit that would is
  // refused before anything is written; one that leaves them paying the
  // same accounts goes on (before migration 118, which brings paid_to,
  // every lane pays the old rule).
  if (affectsPayee && !roleContext.isAdmin && 'paid_to' in existing && payeeRuleLiveNow()) {
    const moves = payeeOf(existing, showBefore) !== payeeOf(next, showAfter)
      || followingExtras.some((x) => payeeOf(x, extrasShowBefore) !== payeeOf(x, extrasShowAfter));
    if (moves) {
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
  // Who the title belongs to (its uploader, whoever runs its show): a team
  // member who is one of them goes the owner's way (the policy above).
  const ownerIds = roleContext.isAdmin === true ? [] : await episodeOwnerIds(existing);
  if (cloudflareVideoUid) {
    if (!roleContext.isAdmin) {
      // A new file on a title that isn't in review is a reviewer's call
      // (2026-11-15): "Create & edit episodes" alone used to swap the file
      // behind a live title with no review. And only a full admin attaches
      // a video someone else uploaded (lib/videoOwnership.js): a sub-admin
      // attaches their own upload, or an untagged one nobody else uses
      // (a file put up through Cloudflare's own dashboard).
      // Their own title's new file waits for approval like any owner's
      // (decided below); someone else's needs the review capability, and
      // waits for another reviewer even then.
      if (existing.status !== 'pending' && !hasCapability(roleContext, 'review_submissions') && !ownerIds.includes(userId)) {
        return res.status(403).json({ error: FILE_REVIEW_LINE, code: 'review' });
      }
      const owned = await checkVideoOwnership(String(cloudflareVideoUid), { userId, isAdmin: false });
      if (!owned.ok) return res.status(owned.status).json({ error: owned.error });
      newVideoStatus = owned.video;
    } else {
      newVideoStatus = await getCloudflareVideoStatus(cloudflareVideoUid);
    }
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
  // Nobody but a full admin approves their own upload (2026-11-15), here as
  // in the review queue.
  if (approving && roleContext.isAdmin !== true && approvesOwnWork(roleContext, await episodeOwnerIds(existing))) {
    return res.status(403).json({ error: OWN_WORK_LINE, code: 'own-work' });
  }
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

  // What each change does on a live title for this account (the policy
  // above), decided before anything is uploaded: a refusal leaves nothing
  // behind, and a change that would wait where the database has nowhere
  // to keep it answers its migration's 503.
  const liveCtx = roleContext.isAdmin === true ? null : {
    target: 'episode',
    isAdmin: true,
    fullAdmin: false,
    reviews: hasCapability(roleContext, 'review_submissions'),
    isUploader: existing.submitted_by === userId,
    isRunner: ownerIds.includes(userId),
    status: existing.status || 'approved',
    held: Boolean(existing.moderation_hold),
    deletionRequested: Boolean(existing.deletion_requested),
    withdrawn: Boolean(existing.withdrawn_at)
  };
  // In review, the team's change applies at once as before.
  const ownPath = Boolean(liveCtx && existing.status !== 'pending' && (liveCtx.isUploader || liveCtx.isRunner));
  const sentence = (line) => (line && !/[.!?]$/.test(line) ? `${line}.` : line || 'That can’t be changed here.');
  const modeFor = (column, value) => {
    if (!liveCtx) return 'direct';
    const entry = STAGEABLE[column];
    // Turning ads off only takes something away: at once.
    if (column === 'ads_enabled' && value === false) return 'direct';
    let field = entry ? entry.field : OWNER_FIELDS[column] || null;
    let mode;
    if (!entry && !ownPath) return 'direct';
    if (column === 'has_flashing_lights') {
      const verdict = flashingLightsChange(liveCtx, Boolean(existing.has_flashing_lights), value === true);
      if (!verdict.ok) throw refuse(sentence(verdict.line), 403, { code: 'own-work', field: 'hasFlashingLights' });
      return 'direct';
    }
    if (column === 'downloads_allowed') return 'direct';
    if (!field) throw refuse(sentence(OWN_TITLE_LINE), 403, { code: 'own-work', field: column });
    if (column === 'src' && existing.status !== 'pending') {
      // A new file from anyone but a full admin is their own upload: the
      // owner's way, waiting for another reviewer on a live title.
      mode = fieldPolicy('video', ownTeamCtx(liveCtx));
      field = 'video';
    } else {
      mode = fieldPolicy(field, liveCtx);
    }
    if (mode === 'locked' || mode === 'invite') throw refuse(sentence(fieldPolicyLine(field, column === 'src' ? ownTeamCtx(liveCtx) : liveCtx)), 403, { code: ownPath ? 'own-work' : 'review', field });
    if (mode === 'staged') {
      if (!entry) throw refuse(sentence(OWN_TITLE_LINE), 403, { code: 'own-work', field });
      if (entry.detail && !Object.prototype.hasOwnProperty.call(existing, 'pending_fields')) throw refuse(LIVE_REVIEW_124_MSG, 503, { code: 'migration-124', field: entry.field });
      if (entry.needs && !Object.prototype.hasOwnProperty.call(existing, entry.needs)) throw refuse(entry.needsMsg, 503, { code: entry.code, field: entry.field });
    }
    return mode;
  };
  for (const [column, value] of Object.entries(changed)) modeFor(column, value);
  if (posterBase64) modeFor('poster');
  if (thumbnailBase64) modeFor('thumbnail');
  if (titleImageBase64 || (removeTitleImage && existing.title_image_url)) modeFor('title_image_url');
  if (newSrc) modeFor('src');

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

  // The changes that wait (their own live title): moved out of the live
  // columns into the waiting ones. A waiting file this replaces is no
  // one's once the save is in.
  const waited = [];
  const waitingReplaced = [];
  const pfChanges = {};
  for (const column of Object.keys(dbUpdates)) {
    if (modeFor(column, dbUpdates[column]) !== 'staged') continue;
    const entry = STAGEABLE[column];
    const value = dbUpdates[column];
    delete dbUpdates[column];
    waited.push(entry.field);
    if (entry.detail) {
      pfChanges[entry.field] = value;
    } else if (column === 'title_image_url') {
      if (existing.pending_title_image_url) waitingReplaced.push(['image', existing.pending_title_image_url]);
      dbUpdates.pending_title_image_url = value;
      dbUpdates.pending_title_image_removal = value === null;
    } else {
      if (['poster', 'thumbnail'].includes(column) && existing[entry.pending]) waitingReplaced.push(['image', existing[entry.pending]]);
      if (column === 'src' && existing.pending_src && cloudflareUidFromUrl(existing.pending_src) !== cloudflareUidFromUrl(value || '')) waitingReplaced.push(['video', existing.pending_src]);
      dbUpdates[entry.pending] = column === 'page_notes' ? (value || '') : value;
    }
  }
  if (Object.keys(pfChanges).length > 0) dbUpdates.pending_fields = nextPendingFields(existing, 'episode', pfChanges);

  // Nothing to write: a save with no change answers as one.
  if (Object.keys(dbUpdates).length === 0) {
    return res.status(200).json({ ok: true, episodeId: existing.id, changed: [] });
  }

  // A move to another show (or out of one) — an extra's new parent in
  // another show too — can change who the title pays (lib/showRules.js
  // payeeOf), and who the extras filed under it pay: their history is
  // written with the save (lib/payees.js, slice 3b; withPayeeStamps takes
  // the extras along). The write's own error is answered below.
  const movesShow = affectsPayee;
  let writeResult = null;
  const doWrite = async () => {
    // Waiting details are one value per title: written only while they are
    // what was read (an approval in between isn't undone).
    writeResult = await updateCompat(supabase, 'episodes', dbUpdates, ['released_at'], (q) => {
      const w = q.eq('id', existing.id);
      if (!Object.prototype.hasOwnProperty.call(dbUpdates, 'pending_fields')) return w;
      return (existing.pending_fields === null || existing.pending_fields === undefined ? w.is('pending_fields', null) : w.eq('pending_fields', JSON.stringify(existing.pending_fields))).select('id');
    });
    if (writeResult.error) throw Object.assign(new Error('edit-episode write'), { editWriteFailed: true });
  };
  let stamped = null;
  if (movesShow) {
    try {
      const placePatch = { series_id: next.series_id || null, bonus_parent_type: next.bonus_parent_type || null, bonus_parent_id: next.bonus_parent_id || null, content_type: next.content_type || null };
      stamped = await withPayeeStamps({ scope: { episodeIds: [existing.id] }, patch: { episodes: { [existing.id]: placePatch } }, write: doWrite, setBy: `edit:${userId}` });
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
  if (Object.prototype.hasOwnProperty.call(dbUpdates, 'pending_fields') && writeResult && Array.isArray(writeResult.data) && writeResult.data.length === 0) {
    for (const url of [poster, thumbnail, titleImageUrl]) {
      const path = storagePathFromUrl(url || '');
      if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason: 'admin edit not saved (changed meanwhile)', context: existing.title });
    }
    return res.status(409).json({ error: 'What waits for approval on it changed a moment ago — reload and try again.', code: 'changed' });
  }
  for (const [kind, ref] of waitingReplaced) {
    if (kind === 'video') {
      const uid = cloudflareUidFromUrl(ref);
      if (uid) await recordOrphan({ kind: 'cloudflare_video', reference: uid, reason: 'staged video replaced by a newer one', context: existing.title });
    } else {
      const path = storagePathFromUrl(ref);
      if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason: 'staged artwork replaced by a newer one', context: existing.title });
    }
  }

  // The files this save replaced, recorded only once it's saved (they
  // used to be recorded before the write, so a failed save marked files
  // still in use as orphans).
  // (A change that waits for approval replaces nothing live yet.)
  const titleImageRemoved = !titleImageUrl && dbUpdates.title_image_url === null;
  const replaced = [
    { gone: Boolean(poster) && 'poster' in dbUpdates && existing.poster, reason: 'artwork replaced by admin (poster)' },
    { gone: Boolean(thumbnail) && 'thumbnail' in dbUpdates && existing.thumbnail, reason: 'artwork replaced by admin (thumbnail)' },
    { gone: (Boolean(titleImageUrl) || titleImageRemoved) && 'title_image_url' in dbUpdates && existing.title_image_url, reason: titleImageRemoved ? 'title image removed by admin (reverted to text title)' : 'artwork replaced by admin (title image)' }
  ];
  for (const { gone, reason } of replaced) {
    const oldPath = gone ? storagePathFromUrl(gone) : null;
    if (oldPath) await recordOrphan({ kind: 'storage_image', reference: oldPath, reason, context: existing.title });
  }
  if (newSrc && dbUpdates.src === newSrc) {
    const oldUid = cloudflareUidFromUrl(existing.src);
    if (oldUid && oldUid !== cloudflareVideoUid) {
      await recordOrphan({ kind: 'cloudflare_video', reference: oldUid, reason: 'video manually replaced by admin', context: existing.title });
    }
  }

  // Whoever it paid until now is told, as a pick would tell them.
  if (stamped && stamped.changed && stamped.changed.length) {
    await noticeEarningsMoved({ changed: stamped.changed, viewer: { userId, email }, how: 'moved' }).catch((err) => console.error('edit-episode earnings notice:', err && err.message));
  }

  // A new runner didn't send its invites and prices it — and the extras
  // filed under it — from now on.
  if (movesShow) {
    // Each title against its own show before and after: the title's, and
    // the one its extras follow (its series_id).
    const byRunner = new Map();
    const runnerMove = (id, before, after) => {
      if (before === after) return;
      const key = after || '';
      if (!byRunner.has(key)) byRunner.set(key, []);
      byRunner.get(key).push(id);
    };
    runnerMove(existing.id, titleRunnerOf(existing, showBefore), titleRunnerOf(next, showAfter));
    for (const x of followingExtras) runnerMove(x.id, titleRunnerOf(x, extrasShowBefore), titleRunnerOf(x, extrasShowAfter));
    const moved = [...byRunner.values()].flat();
    if (moved.length) {
      await cancelPendingInvites({ titles: moved.map((id) => ({ type: 'episode', id })), reason: 'runner', actor: { userId, email, isAdmin: true } })
        .catch((err) => console.error('edit-episode invites:', err && err.message));
      for (const [runnerAfter, ids] of byRunner) {
        if (!runnerAfter) continue;
        const { error: priceError } = await supabase.from('title_prices').update({ creator_id: runnerAfter }).eq('target_type', 'episode').in('target_id', ids);
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
  const answer = { ok: true, episodeId: existing.id, changed: columns.filter((c) => !c.startsWith('pending_')) };
  // What waits for approval (their own live title): said, and listed.
  if (waited.length) {
    answer.staged = waited;
    answer.stagedNote = 'It’s your own title, so these wait for someone else on the team to approve them.';
  }
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
