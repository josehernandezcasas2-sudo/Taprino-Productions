import { getSupabase } from './supabase';
import { insertCompat, updateCompat } from './dbCompat';
import { internalError } from './apiErrors';
import { invalidateCache } from './redis';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { recordOrphan, storagePathFromUrl } from './orphanedMedia';
import { getPublicIdentities } from './userProfiles';
import { creatorOwnsSeries, seasonLabelsOf } from './series';
import { signTrailerSrc } from './heroCandidates';
import { sortEpisodes } from './seriesResume';
import { getPriceRow } from './purchases';
import { deleteDraft, isMissingDraftsTable } from './creatorDrafts';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl, getCloudflareVideoStatus } from './cloudflareUpload';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from './videoOwnership';
import { uploadArtworkImage } from './artworkUpload';
import { uploadCaptionFile } from './captionUpload';
import { normalizeUrl } from './normalizeUrl';
import { isTitleId } from './titleIds';
import {
  DRAFTS_CAP, MAX_EPISODE_NUMBER, SHOW_KINDS,
  applyShowDefaults, canMakePublic, creditLines, episodeDisplayTitle, episodeHasPage, inRunningOrder, isPublicShow, kindFromEpisodes,
  kindOf, masterReady, masterState, nextFreeNumber, normalizeCredits, normalizeShowDefaults, payeeOf, planMove, positionsFor,
  seasonLabel, seesWhoIsPaid, showProblems, showState, slotCheck
} from './showRules';

// SERVER-ONLY. The show page's data (the series revamp, slice 1:
// mockups/series-revamp-spec.md): one place that reads a show for its
// control room, makes a show, sends a title in (submit-episode's core),
// renumbers a season, moves an episode and makes a show public. The rules
// themselves are lib/showRules.js (pure, shared with the app); this file
// only feeds them and writes what they decide. Nothing here is on a page
// yet — slice 2 builds the routes and screens on top.
//
// Migration 118 is run by hand and the code is a step ahead of it, so
// everything here works before it has run:
//   - a show is read with select('*') (a missing column is simply absent;
//     `kind` on the row says 118 has run);
//   - episodes are read with SELECT, and again with SELECT_LEGACY (no 118
//     columns) when the database says a column is missing;
//   - writes that carry a 118 column go through insertCompat /
//     updateCompat (lib/dbCompat.js), which retry without them;
//   - the two renumbering functions (reorder_show_season, move_episode)
//     have a JS fallback that writes the same numbers in two awaited
//     phases (out of the way first, then into place) when PostgREST
//     doesn't know the function; the answer says `fallback: true`.

// An error with a line written for the person (and a status). Routes pass
// it to sendError (lib/apiErrors.js), which sends the line as it is; a
// database error is marked with internalError() instead and never echoed.
// `extra` rides along for a route that answers more than the line (a
// taken number's holder and the next free one).
export class ShowError extends Error {
  constructor(message, status = 400, extra = null) {
    super(message);
    this.status = status;
    if (extra) this.extra = extra;
  }
}

// --- what the database has -----------------------------------------------------

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

function isMissingFunction(error) {
  return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message || ''));
}

// Any of the above: a database that hasn't run migration 118 yet.
export function isMissingShowsMigration(error) {
  return isMissingColumn(error) || isMissingTable(error) || isMissingFunction(error);
}

export const MIGRATION_118_MSG = 'This needs a database update first (migration 118).';

// The series columns migration 118 adds. Writes carry them as optional
// keys; a show row read with select('*') has `kind` once 118 has run.
export const SERIES_118_KEYS = ['kind', 'defaults', 'seasons', 'decision_note', 'submitted_by_user_id', 'reviewed_by_user_id', 'paid_to', 'credits', 'public_at'];

export function seriesRowHas118(row) {
  return Boolean(row) && Object.prototype.hasOwnProperty.call(row, 'kind');
}

// Every episode column the show page reads. SELECT_LEGACY is the list as
// of migration 117; SELECT adds migration 118's.
const EPISODE_LEGACY_COLUMNS = [
  'id', 'title', 'description', 'status', 'content_type', 'series_id', 'season', 'series_order', 'submitted_by', 'created_at', 'released_at',
  'src', 'audio_url', 'trailer_src', 'thumbnail', 'poster', 'title_image_url', 'hero_image', 'captions_url',
  'tier', 'rating', 'runtime', 'genre', 'main_genre', 'artist', 'release_year', 'ads_enabled', 'funding_url', 'channel_opt_in', 'is_original', 'featured',
  'moderation_hold', 'deletion_requested', 'deletion_requested_at', 'deletion_reason', 'withdrawn_at', 'rejection_reason',
  'pending_title', 'pending_description', 'pending_poster', 'pending_thumbnail', 'bonus_parent_type', 'bonus_parent_id', 'available_from', 'available_until'
];
export const EPISODE_118_COLUMNS = ['has_page', 'page_notes', 'pending_src', 'paid_to', 'credits', 'captions_stale_at'];
export const SELECT_LEGACY = EPISODE_LEGACY_COLUMNS.join(', ');
export const SELECT = [...EPISODE_LEGACY_COLUMNS, ...EPISODE_118_COLUMNS].join(', ');

// Episodes, read with SELECT and again with SELECT_LEGACY when a 118
// column is missing. `build(query)` adds the filters.
async function selectEpisodes(build, context) {
  const supabase = getSupabase();
  let { data, error } = await build(supabase.from('episodes').select(SELECT));
  if (error && isMissingColumn(error)) {
    ({ data, error } = await build(supabase.from('episodes').select(SELECT_LEGACY)));
    if (error) throw internalError(error, context);
    return { rows: data || [], has118: false };
  }
  if (error) throw internalError(error, context);
  return { rows: data || [], has118: true };
}

async function readShowRow(seriesId, context) {
  const { data, error } = await getSupabase().from('series').select('*').eq('id', seriesId).maybeSingle();
  if (error) throw internalError(error, context);
  return data || null;
}

// --- small helpers -------------------------------------------------------------

function blank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function posInt(v) {
  if (blank(v) || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A runtime typed as seconds, as the site writes it ("MM:SS" / "H:MM:SS").
function runtimeClock(seconds) {
  const total = Math.round(Number(seconds));
  if (!(total > 0)) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Cloudflare's own frame grab (…/thumbnails/thumbnail.jpg) stops loading
// once a video demands signed links, so the show page never shows one:
// a row's own art, or nothing (the page then uses the show's still).
const CLOUDFLARE_FRAME = /(cloudflarestream\.com|videodelivery\.net)\/[^/]+\/thumbnails\//i;
function ownArt(url) {
  return url && !CLOUDFLARE_FRAME.test(String(url)) ? url : null;
}

function codeOf(season, number) {
  return number ? `S${season || 1} E${number}` : null;
}

// Title ids are text slugs, distinct even when two are minted in the same
// millisecond (a batch): the second gets a counter. A show's id ends in
// "-show", so a show and its first episode, made in one go, never share
// an id (acceptApplication used to give both the same one).
let lastMint = { stamp: '', n: 0 };
export function mintTitleId(text, { suffix = '', fallback = 'title' } = {}) {
  const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80).replace(/-+$/, '') || fallback;
  const stamp = Date.now().toString(36);
  if (stamp === lastMint.stamp) lastMint = { stamp, n: lastMint.n + 1 };
  else lastMint = { stamp, n: 0 };
  return `${slug}-${stamp}${lastMint.n ? `-${lastMint.n.toString(36)}` : ''}${suffix}`;
}

// A video's state on Cloudflare, remembered for a minute per uid (the
// show page asks about every episode still in review).
const VIDEO_STATE_MS = 60 * 1000;
const videoStates = new Map();
async function videoStateFor(uid) {
  if (!uid) return null;
  const hit = videoStates.get(uid);
  if (hit && Date.now() - hit.at < VIDEO_STATE_MS) return hit.state;
  const status = await getCloudflareVideoStatus(uid).catch(() => null);
  const state = status ? { state: status.state || null, readyToStream: Boolean(status.readyToStream) } : null;
  videoStates.set(uid, { at: Date.now(), state });
  if (videoStates.size > 500) videoStates.delete(videoStates.keys().next().value);
  return state;
}

// --- the control room ------------------------------------------------------------

// A show's drafts (creator_drafts, migration 116, the show in form.seriesId)
// belonging to these accounts, newest first, at most DRAFTS_CAP.
async function readShowDrafts(seriesId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return { drafts: [], available: true };
  const { data, error } = await getSupabase().from('creator_drafts').select('*').in('user_id', ids).order('updated_at', { ascending: false }).limit(DRAFTS_CAP * 3);
  if (error) {
    if (isMissingDraftsTable(error)) return { drafts: [], available: false };
    console.error('showPage drafts:', error.message);
    return { drafts: [], available: true };
  }
  const drafts = (data || []).filter((d) => d && d.form && typeof d.form === 'object' && String(d.form.seriesId || '') === String(seriesId)).slice(0, DRAFTS_CAP);
  return { drafts, available: true };
}

// A draft as a row the rules read: its season and number sit in its form.
function draftAsRow(d) {
  const form = d.form || {};
  return {
    id: d.id,
    kind: 'draft',
    form,
    title: blank(form.title) ? null : String(form.title).trim(),
    contentType: form.contentType || null,
    video: d.video_uid ? { uid: d.video_uid, state: d.video_state || null } : null,
    createdAt: d.created_at || null,
    userId: d.user_id || null,
    updatedAt: d.updated_at || null,
    raw: d
  };
}

function episodeView(r, ctx) {
  const mine = Boolean(ctx.userId && r.submitted_by === ctx.userId);
  const full = ctx.teamView || ctx.isOwner || mine;
  const base = {
    kind: 'episode',
    id: r.id,
    title: r.title ?? null,
    displayTitle: episodeDisplayTitle(r, ctx.show),
    season: r.season ?? null,
    seriesOrder: r.series_order ?? null,
    code: codeOf(r.season, r.series_order),
    status: r.status ?? null,
    contentType: r.content_type ?? null,
    held: Boolean(r.moderation_hold),
    deletionRequested: Boolean(r.deletion_requested),
    withdrawnAt: r.withdrawn_at ?? null,
    inRunningOrder: inRunningOrder(r),
    runtime: r.runtime ?? null,
    thumbnail: ownArt(r.thumbnail),
    createdAt: r.created_at ?? null,
    releasedAt: r.released_at ?? null,
    mine
  };
  if (!full) return base;
  // Cloudflare's word when it was asked (episodes in review), else what
  // the row says: an approved one isn't asked again.
  const state = ctx.states.get(r.id);
  const staged = {
    title: r.pending_title ?? null,
    description: r.pending_description ?? null,
    poster: r.pending_poster ?? null,
    thumbnail: r.pending_thumbnail ?? null,
    newVideo: Boolean(r.pending_src)
  };
  return {
    ...base,
    description: r.description ?? null,
    poster: ownArt(r.poster),
    tier: r.tier === 'premium' ? 'premium' : 'free',
    rating: r.rating ?? null,
    mainGenre: r.main_genre ?? null,
    genre: r.genre ?? null,
    artist: r.artist ?? null,
    releaseYear: r.release_year ?? null,
    adsEnabled: r.ads_enabled !== false,
    channelOptIn: Boolean(r.channel_opt_in),
    fundingUrl: r.funding_url ?? null,
    hasCaptions: Boolean(r.captions_url),
    // A new video approved over captions timed to the old one (amendment 9).
    captionsStale: Boolean(r.captions_url && r.captions_stale_at),
    hasTrailer: Boolean(r.trailer_src),
    hasPage: episodeHasPage(r),
    hasPageChoice: typeof r.has_page === 'boolean' ? r.has_page : null,
    pageNotes: r.page_notes ?? null,
    master: masterState(r, state),
    masterReady: masterReady(r, state),
    rejectionReason: r.status === 'rejected' ? r.rejection_reason ?? null : null,
    deletionReason: r.deletion_requested ? r.deletion_reason ?? null : null,
    staged,
    submittedBy: r.submitted_by ?? null,
    uploaderName: r.submitted_by && r.submitted_by !== ctx.ownerId ? ctx.nameOf(r.submitted_by) : null,
    paidTo: ctx.seesPay ? payeeOf(r, ctx.show) : null
  };
}

function draftView(d, ctx) {
  const form = d.form || {};
  const mine = Boolean(ctx.userId && d.userId === ctx.userId);
  const view = {
    kind: 'draft',
    id: d.id,
    title: d.title,
    displayTitle: d.title || (posInt(form.seriesOrder) ? `Episode ${posInt(form.seriesOrder)}` : 'Untitled'),
    season: posInt(form.season),
    seriesOrder: posInt(form.seriesOrder),
    code: codeOf(posInt(form.season), posInt(form.seriesOrder)),
    status: 'draft',
    contentType: form.contentType || null,
    master: masterState(d),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    mine
  };
  // The upload in flight (its tus address resumes it) is the author's own.
  if (mine && d.raw) {
    view.video = d.raw.video_uid ? {
      uid: d.raw.video_uid,
      state: d.raw.video_state || null,
      name: d.raw.video_name || null,
      bytes: d.raw.video_bytes || null,
      uploadUrl: d.raw.upload_url || null,
      runtimeSeconds: d.raw.runtime_seconds || null
    } : null;
  }
  return view;
}

// What the show page shows for one show (spec, "GET /api/show/[id]"), for
// its owner, the team, or someone with an episode in it (a contributor:
// the show read-only, their own rows in full). Null for anyone else, or a
// show that doesn't exist; the route answers both 404.
//   viewer = { userId, isAdmin (a full admin), canAccessAdmin (the team) }
//   opts.videoStates (default true): ask Cloudflare about every episode
//   still in review (a minute's memo per video), for the file lines.
// The answer: { show, seasons: [{ number, label, rows }], extras, problems,
// counts, money, price, viewer, migration }. A season's rows come in play
// order (lib/seriesResume.js sortEpisodes): episodes and drafts, with a
// { kind: 'gap', from, to } row where numbers are missing. `money` is who
// runs the show and who it pays (decision 19) — only for those who may see
// it (lib/showRules.js seesWhoIsPaid), never for viewers; money lanes
// don't read it yet.
export async function getShowPage(seriesId, viewer = {}, { videoStates: askVideoStates = true } = {}) {
  if (!isTitleId(seriesId)) return null;
  const show = await readShowRow(seriesId, 'getShowPage series');
  if (!show) return null;
  const userId = viewer && viewer.userId ? viewer.userId : null;
  const isAdmin = Boolean(viewer && viewer.isAdmin === true);
  const teamView = isAdmin || Boolean(viewer && viewer.canAccessAdmin === true);
  const isOwner = Boolean(userId && show.creator_id === userId);

  const { rows: allRows, has118: episodes118 } = await selectEpisodes((q) => q.eq('series_id', seriesId), 'getShowPage episodes');
  const isContributor = Boolean(userId && allRows.some((r) => r.submitted_by === userId));
  if (!isOwner && !teamView && !isContributor) return null;

  const episodes = allRows.filter((r) => r.content_type !== 'bonus');
  const episodeIds = episodes.map((r) => r.id);
  const [anchoredToShow, anchoredToEpisodes] = await Promise.all([
    selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'series').eq('bonus_parent_id', seriesId), 'getShowPage extras'),
    episodeIds.length > 0
      ? selectEpisodes((q) => q.eq('content_type', 'bonus').eq('bonus_parent_type', 'episode').in('bonus_parent_id', episodeIds), 'getShowPage anchored extras')
      : Promise.resolve({ rows: [], has118: true })
  ]);
  const extrasRows = [];
  const seen = new Set();
  for (const r of [...allRows.filter((x) => x.content_type === 'bonus'), ...anchoredToShow.rows, ...anchoredToEpisodes.rows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    extrasRows.push(r);
  }

  // Drafts: the viewer's own; the team also sees the owner's.
  const draftOwners = teamView ? [userId, show.creator_id] : [userId];
  const { drafts: draftRowsRaw, available: drafts116 } = await readShowDrafts(seriesId, draftOwners);
  const drafts = draftRowsRaw.map(draftAsRow);

  // Who's who: the owner, who the show pays, every uploader, the credits'
  // linked accounts.
  const credits = normalizeCredits(show.credits);
  const people = [show.creator_id, show.paid_to, ...episodes.map((r) => r.submitted_by), ...episodes.map((r) => r.paid_to),
    credits.studio && credits.studio.userId, credits.producer && credits.producer.userId].filter(Boolean);
  const identities = await getPublicIdentities(people).catch(() => ({}));
  const nameOf = (id) => (id && identities[id] ? identities[id].displayName || null : null);

  // Cloudflare's word on the files still in review (approved ones played
  // already); the owner's and the team's view only.
  const states = new Map();
  if (askVideoStates && (isOwner || teamView || isContributor)) {
    const ask = episodes
      .filter((r) => r.status !== 'approved' && (isOwner || teamView || r.submitted_by === userId))
      .map((r) => ({ id: r.id, uid: cloudflareUidFromUrl(r.src || '') }))
      .filter((x) => x.uid)
      .slice(0, 40);
    const answers = await Promise.all(ask.map((x) => videoStateFor(x.uid)));
    ask.forEach((x, i) => { if (answers[i]) states.set(x.id, answers[i]); });
  }

  const kind = kindOf(show, episodes);
  const seesPay = seesWhoIsPaid({ viewerId: userId, isAdmin: teamView, show, episodes });
  const ctx = { userId, isOwner, teamView, ownerId: show.creator_id || null, show, states, nameOf, seesPay };

  // The running order and the rest, season by season, in play order, with
  // the gaps the rules find.
  const rulesRows = [...episodes, ...drafts];
  const seasonNumbers = [...new Set(rulesRows.map((r) => posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1))].sort((a, b) => a - b);
  const seasons = seasonNumbers.map((number) => {
    const inSeason = sortEpisodes(rulesRows.filter((r) => (posInt(r.season !== undefined ? r.season : (r.form && r.form.season)) || 1) === number));
    const gaps = positionsFor(rulesRows, number, { kind }).gaps;
    const views = [];
    let g = 0;
    for (const r of inSeason) {
      const n = posInt(r.series_order !== undefined ? r.series_order : (r.form && r.form.seriesOrder));
      while (g < gaps.length && n !== null && n > gaps[g].to) {
        views.push(gapRow(number, gaps[g]));
        g += 1;
      }
      views.push(r.kind === 'draft' ? draftView(r, ctx) : episodeView(r, ctx));
    }
    while (g < gaps.length) {
      views.push(gapRow(number, gaps[g]));
      g += 1;
    }
    return { number, label: seasonLabel(show, number), rows: views };
  });

  const extras = sortEpisodes(extrasRows).map((r) => ({
    ...episodeView(r, ctx),
    kind: 'extra',
    anchor: r.bonus_parent_type === 'episode' ? { episodeId: r.bonus_parent_id, code: (() => {
      const ep = episodes.find((e) => e.id === r.bonus_parent_id);
      return ep ? codeOf(ep.season, ep.series_order) : null;
    })() } : null
  }));

  const fullView = isOwner || teamView;
  const [trailer, stagedTrailer, priceRow] = await Promise.all([
    show.trailer_src ? signTrailerSrc(show.trailer_src) : null,
    fullView && show.pending_trailer_src ? signTrailerSrc(show.pending_trailer_src) : null,
    fullView ? getPriceRow('series', seriesId).catch(() => null) : null
  ]);

  const state = showState(show, rulesRows);
  const showPayee = show.paid_to || show.creator_id || null;
  const view = {
    show: {
      id: show.id,
      name: show.name ?? null,
      kind,
      status: show.status || 'approved',
      state: state ? state.key : null,
      statusLabel: state ? state.label : null,
      headline: state ? state.headline : null,
      level: state ? state.level : null,
      isPublic: isPublicShow(show),
      description: show.description ?? null,
      year: show.release_year || null,
      fundingUrl: show.funding_url ?? null,
      channelOptIn: Boolean(show.channel_opt_in),
      defaults: normalizeShowDefaults(show.defaults),
      credits,
      creditLines: creditLines(null, show, nameOf),
      seasonLabels: seasonLabelsOf(show.seasons),
      art: {
        poster: show.poster ?? null,
        thumbnail: show.thumbnail ?? null,
        heroImage: show.hero_image ?? null,
        titleImageUrl: show.title_image_url ?? null,
        trailer: show.trailer_src ? { src: trailer ? trailer.src : null, expiresAt: trailer ? trailer.expiresAt : null, ref: { seriesId: show.id } } : null
      },
      staged: fullView ? {
        name: show.pending_name ?? null,
        description: show.pending_description ?? null,
        poster: show.pending_poster ?? null,
        thumbnail: show.pending_thumbnail ?? null,
        heroImage: show.pending_hero_image ?? null,
        titleImageUrl: show.pending_title_image_url ?? null,
        titleImageRemoval: Boolean(show.pending_title_image_removal),
        trailer: show.pending_trailer_src ? { src: stagedTrailer ? stagedTrailer.src : null, expiresAt: stagedTrailer ? stagedTrailer.expiresAt : null } : null
      } : null,
      deletion: { requested: Boolean(show.deletion_requested), reason: fullView ? show.deletion_reason ?? null : null, at: show.deletion_requested_at ?? null },
      held: Boolean(show.moderation_hold),
      decisionNote: fullView ? show.decision_note ?? null : null,
      publicAt: show.public_at ?? null,
      createdAt: show.created_at ?? null,
      ownerId: show.creator_id ?? null,
      ownerName: nameOf(show.creator_id),
      canEditShow: isOwner || isAdmin
    },
    seasons,
    extras,
    problems: fullView ? showProblems(show, rulesRows, { kind }) : [],
    counts: {
      episodes: episodes.length,
      live: episodes.filter((r) => r.status === 'approved' && !r.moderation_hold && !r.deletion_requested && !r.withdrawn_at).length,
      inReview: episodes.filter((r) => r.status === 'pending').length,
      declined: episodes.filter((r) => r.status === 'rejected').length,
      drafts: drafts.length,
      extras: extras.length,
      seasons: seasons.length
    },
    // Decision 19: who runs it and who it pays. Data only — no money lane
    // reads this yet (paid_to is always null until a later slice lets
    // someone set it).
    money: seesPay ? {
      runsIt: { userId: show.creator_id ?? null, name: nameOf(show.creator_id) },
      paidTo: { userId: showPayee, name: nameOf(showPayee), chosen: Boolean(show.paid_to) },
      paidElsewhere: episodes
        .filter((r) => r.content_type !== 'bonus' && payeeOf(r, show) && payeeOf(r, show) !== showPayee)
        .map((r) => ({ id: r.id, code: codeOf(r.season, r.series_order), userId: payeeOf(r, show), name: nameOf(payeeOf(r, show)) }))
    } : null,
    price: priceRow ? { status: priceRow.status || null, priceCents: priceRow.price_cents ?? null, pendingCents: priceRow.pending_cents ?? null } : null,
    viewer: { userId, isOwner, isAdmin, teamView, isContributor, canEditShow: isOwner || isAdmin, seesWhoIsPaid: seesPay },
    // Which migrations the database has: 118 (shows) and 116 (drafts).
    // fallback118 = the page reads without the 118 columns and renumbers
    // through the slower JS path.
    migration: { shows118: seriesRowHas118(show) && episodes118, drafts116 },
    fallback118: !(seriesRowHas118(show) && episodes118)
  };
  return view;
}

function gapRow(season, gap) {
  return {
    kind: 'gap',
    id: `gap-${season}-${gap.from}`,
    season,
    from: gap.from,
    to: gap.to,
    words: gap.from === gap.to ? `E${gap.from} is missing` : `E${gap.from}–E${gap.to} are missing`
  };
}

// --- making a show ---------------------------------------------------------------

// The one place a show row is written (the spec's createShow): a distinct
// id ("<name>-<stamp>-show", or the caller's), the defaults its episodes
// start from (lib/showRules.js normalizeShowDefaults), and — decision 2 —
// private: status 'pending', written out, until its owner or a full admin
// makes it public. `live: true` is for the full-admin decisions that put a
// show up at once (accepting an application, an admin's "Live now"): then
// it is approved with public_at now. The 118 columns (kind, defaults,
// credits, the Clerk ids, public_at) are optional keys, so this works
// before 118 has run. Throws ShowError for what the person typed.
//   → { id, name, kind, status, publicAt, has118 }
export async function createShow(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ShowError('A show needs a name.');
  if (name.length > 120) throw new ShowError('A show’s name is limited to 120 characters.');
  const kind = input.kind || 'series';
  if (!SHOW_KINDS.includes(kind) || (kind === 'vertical' && input.allowVertical !== true)) throw new ShowError('A show is a series or a podcast.');
  if (input.id !== undefined && input.id !== null && !isTitleId(String(input.id))) throw new ShowError('That isn’t a usable id for a show.');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 2000) || null : null;
  const year = posInt(input.releaseYear);
  const live = input.live === true;
  const now = new Date().toISOString();

  const row = {
    name,
    description,
    poster: input.poster || null,
    thumbnail: input.thumbnail || null,
    release_year: year && year >= 1800 && year <= 2200 ? year : null,
    funding_url: typeof input.fundingUrl === 'string' && input.fundingUrl.trim() ? normalizeUrl(input.fundingUrl) : null,
    creator_id: input.creatorId || null,
    // A show doesn't air on the channels until its owner says so (the
    // inline new show used to copy the episode's tick).
    channel_opt_in: input.channelOptIn === true,
    submitted_by: input.submittedBy || null,
    // Written out rather than left to the column defaults (both false since
    // migrations 004 / 072), so a show made here is never hidden by a
    // reader's `deletion_requested = false` filter on a database or a
    // stand-in that leaves them null.
    deletion_requested: false,
    moderation_hold: false,
    status: live ? 'approved' : 'pending',
    ...(live ? { reviewed_by: input.reviewedBy || null, reviewed_at: now } : {}),
    // Migration 118 (dropped by insertCompat before it has run).
    kind,
    defaults: normalizeShowDefaults(input.defaults),
    credits: normalizeCredits(input.credits),
    submitted_by_user_id: input.submittedByUserId || input.creatorId || null,
    ...(live ? { reviewed_by_user_id: input.reviewedByUserId || null, public_at: now } : {})
  };

  const supabase = getSupabase();
  const given = input.id ? String(input.id) : null;
  let id = given || mintTitleId(name, { suffix: '-show', fallback: 'show' });
  let res = await insertCompat(supabase, 'series', { id, ...row }, SERIES_118_KEYS, { select: '*' });
  if (res.error && res.error.code === '23505' && !given) {
    id = mintTitleId(name, { suffix: '-show', fallback: 'show' });
    res = await insertCompat(supabase, 'series', { id, ...row }, SERIES_118_KEYS, { select: '*' });
  }
  if (res.error) {
    if (res.error.code === '23505') throw new ShowError('A show with that id already exists.', 409);
    throw internalError(res.error, 'createShow');
  }
  if (live) await invalidateCache('all_series_approved_v1');
  return { id, name, kind, status: row.status, publicAt: live ? now : null, has118: seriesRowHas118(res.data) };
}

// --- sending a title in (submit-episode's core) --------------------------------

// Every one of these has to be present and non-empty — this is the actual
// enforcement of "creators must submit complete metadata," not just a UI
// nicety. A form can be bypassed by anyone calling the route directly;
// this check can't be.
const REQUIRED_FIELDS = ['title', 'description', 'contentType', 'genre', 'mainGenre', 'runtime', 'artist', 'tier'];
const VALID_TIERS = ['free', 'premium'];
const VALID_CONTENT_TYPES = ['series', 'movie', 'short', 'vertical', 'podcast', 'bonus'];
const NUMBERED_TYPES = ['series', 'podcast'];
const DEFAULT_KEYS = ['tier', 'rating', 'mainGenre', 'genre', 'artist', 'adsEnabled'];

// A show's rows as the numbering rules need them.
async function showSlotRows(seriesId) {
  const { data, error } = await getSupabase().from('episodes').select('id, title, season, series_order, status, content_type, withdrawn_at, created_at').eq('series_id', seriesId);
  if (error) throw internalError(error, 'show slots');
  return data || [];
}

// Whether a show takes a new title of this type, before anything is
// uploaded or written (the spec's submit-episode notes: "a show that is
// rejected / held / removal-requested / another kind refused"). The same
// lines the pickers grey a show with (lib/series.js pickBlocker), plus the
// kind:
//   - a declined or pulled show takes nothing new (an admin may still file
//     into one, as on the Move sheet); a show whose removal is requested
//     takes nothing from anyone;
//   - a vertical series is the studio's, and never takes a series or a
//     podcast episode;
//   - an episode joins only a show of its kind. The kind is the column
//     (migration 118) once the show has an episode in its running order,
//     or before 118 what those episodes are. A show with none yet takes
//     either kind and the first one sets it (`adopt`, written after the
//     episode is): a show made through "Add series" (create-series, which
//     sends no kind) reads as a series after 118 even when it is meant
//     for a podcast.
// rows = the show's episodes (showSlotRows), needed for an episode only.
//   → { refusal: ShowError | null, adopt: 'series' | 'podcast' | null }
function showTakes(show, rows, contentType, { isAdmin = false } = {}) {
  const refuse = (message) => ({ refusal: new ShowError(message, 400, { code: 'show-closed' }), adopt: null });
  const column = SHOW_KINDS.includes(show.kind) ? show.kind : null;
  if (show.deletion_requested) return refuse('That show’s removal is requested — it takes nothing new.');
  if (show.status === 'rejected' && !isAdmin) return refuse('An admin declined that show — resubmit it before adding to it.');
  if (show.moderation_hold && !isAdmin) return refuse('That show is pulled while an admin looks at it — nothing can be added for now.');
  if (!NUMBERED_TYPES.includes(contentType)) {
    // Bonus content: no number and no kind of its own, only the show's door.
    if (column === 'vertical' && !isAdmin) return refuse('Vertical series are set up by the studio.');
    return { refusal: null, adopt: null };
  }
  if (column === 'vertical') return refuse('That is a vertical series: it takes Snippets, set up by the studio.');
  const placed = (rows || []).filter((r) => inRunningOrder(r) && NUMBERED_TYPES.includes(r.content_type));
  if (placed.length === 0) {
    return { refusal: null, adopt: seriesRowHas118(show) && column !== contentType ? contentType : null };
  }
  const kind = column || kindFromEpisodes(placed);
  if (kind !== contentType) {
    return refuse(contentType === 'podcast'
      ? 'That show is a series: a podcast episode goes into a podcast.'
      : 'That show is a podcast: a series episode goes into a series.');
  }
  return { refusal: null, adopt: null };
}

function slotTaken(slot, season, number) {
  return new ShowError(
    `${slot.words}. The next free number is E${slot.nextFree}.`,
    409,
    { code: 'taken', season, number, holder: slot.holder ? { id: slot.holder.id, title: slot.holder.title || null } : null, nextFree: slot.nextFree }
  );
}

// Sends one title in for review: what pages/api/creator/submit-episode.js
// did inline until the series revamp, shared with the show page's "Send N
// for review" (slice 2). The route checks the role and the limits; this
// checks everything about the title, then writes it:
//   - the show it goes into fills in what the form left blank — Who can
//     watch, the rating, the genres, Made by, ads — from the show's
//     defaults (decision 9, amendment 2), copied onto the row;
//   - a series or podcast episode without a number takes the show's next
//     free one; a number another episode holds is refused with 409, the
//     holder and the next free number (lib/showRules.js slotCheck);
//   - the show has to take it: not declined, pulled or leaving, not a
//     vertical series, and of the episode's kind (showTakes);
//   - "+ New show" (newSeriesName) is made only after every check has
//     passed, through createShow (private, the episode's choices as its
//     defaults, not on the channels), and removed again if the episode
//     can't be saved; "__new__" without a name is refused;
//   - a number taken between the check and the write (another send at
//     the same moment, under migration 118's unique index) is retried
//     with the next free number when the number was ours to pick.
// viewer = { userId, email, isAdmin }. Throws ShowError (or a plain Error
// from the artwork upload, a line for the person) for anything refused.
//   → { ok, id, status: 'pending', seriesId, season, seriesOrder,
//       numberPicked, newShow }
export async function submitDraft(input, viewer = {}) {
  const userId = viewer && viewer.userId ? viewer.userId : null;
  const email = viewer && viewer.email ? viewer.email : null;
  const isAdmin = Boolean(viewer && viewer.isAdmin === true);
  if (!userId) throw new ShowError('Sign in first.', 401);
  const body = { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : {}) };
  const supabase = getSupabase();

  // The three-step submit page (2026-10-31) sends what it read from the
  // file and the main genre doubles as the specific one when none was typed.
  if (blank(body.runtime) && Number(body.runtimeSeconds) > 0) body.runtime = runtimeClock(body.runtimeSeconds);

  const numbered = NUMBERED_TYPES.includes(body.contentType);
  const showWord = body.contentType === 'podcast' ? 'show' : 'series';
  const newSeriesName = typeof body.newSeriesName === 'string' ? body.newSeriesName.trim().slice(0, 120) : '';
  const makesShow = Boolean(newSeriesName) && numbered;
  // "__new__" (an old picker's "a new series not listed here") used to
  // leave the episode in no show at all, for an admin to file during
  // review; a new show is now made from its name ("+ New show"), so the
  // sentinel alone is refused (the series revamp's bug list).
  if ((numbered || body.contentType === 'bonus') && String(body.seriesId || '').trim() === '__new__' && !makesShow) {
    throw new ShowError(numbered ? 'Name the new show.' : 'Choose which show this bonus content is for.');
  }
  const targetsShow = (numbered || body.contentType === 'bonus') && !blank(body.seriesId) && !makesShow;

  // The show it goes into, and its defaults for whatever was left blank.
  let show = null;
  if (targetsShow) {
    if (!isTitleId(String(body.seriesId))) throw new ShowError('That show isn’t there any more — pick another.', 400);
    show = await readShowRow(String(body.seriesId), 'submitDraft show');
    if (!show) throw new ShowError('That show isn’t there any more — pick another.', 400);
    if (numbered) {
      const filled = applyShowDefaults(Object.fromEntries(DEFAULT_KEYS.map((k) => [k, body[k]])), show);
      for (const k of DEFAULT_KEYS) body[k] = filled[k];
    }
  }
  if (blank(body.genre) && !blank(body.mainGenre)) body.genre = body.mainGenre;
  if (blank(body.tier)) body.tier = 'free';

  const missing = REQUIRED_FIELDS.filter((f) => blank(body[f]) || String(body[f]).trim() === '');
  if (missing.length > 0) throw new ShowError(`Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  if (!VALID_TIERS.includes(body.tier)) throw new ShowError(`tier must be one of: ${VALID_TIERS.join(', ')}`);
  if (!VALID_CONTENT_TYPES.includes(body.contentType)) throw new ShowError(`contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}`);

  // Series and podcast episodes always belong to a show (a podcast's even
  // when it has one episode so far); a standalone film, short or Snippet
  // has no season or number. The number may be left for the show's next
  // free one (the same words as the submit page, lib/submitRules.js).
  if (numbered && !makesShow && blank(body.seriesId)) throw new ShowError(`Pick the ${showWord}, or name a new one.`);
  // Bonus content attaches to a show but isn't part of its own numbered
  // episode sequence — no season/order needed, just which show it's for.
  if (body.contentType === 'bonus' && blank(body.seriesId)) throw new ShowError('Choose which show this bonus content is for.');
  // Every title needs at least one way to play: a video, an audio file, or
  // both (a podcast can be either or both).
  if (!body.videoUid && !body.audioUrl) throw new ShowError('Add a video, an audio file, or both — there’s nothing to play otherwise.');

  // Its place, as typed: a season from 1, a number from 1 (or none, for
  // the next free one).
  let season = null;
  let typed = null;
  if (numbered) {
    if (!blank(body.season) && !posInt(body.season)) throw new ShowError('Seasons are numbered from 1.');
    season = posInt(body.season) || 1;
    typed = blank(body.seriesOrder) ? null : Number(body.seriesOrder);
    if (typed !== null && !posInt(typed)) throw new ShowError('Episode numbers start at 1.');
    if (typed !== null && typed > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers go up to ${MAX_EPISODE_NUMBER}.`);
  }

  // An episode or bonus clip goes only into the creator's own series: the
  // review queue doesn't show which series a submission targets, so this
  // used to let one creator file episodes into another's show. Checked
  // before anything is uploaded, and before the show's own state is told
  // to someone it doesn't belong to.
  if (targetsShow && !(await creatorOwnsSeries(userId, show.id, { isAdmin }))) {
    throw new ShowError('You can only add episodes to your own series.', 403);
  }
  // Whether that show takes it: declined, pulled, leaving, vertical or
  // another kind are refused here, before anything is uploaded.
  let slotRows = null;
  let adoptKind = null;
  if (targetsShow) {
    if (numbered) slotRows = await showSlotRows(show.id);
    const verdict = showTakes(show, slotRows, body.contentType, { isAdmin });
    if (verdict.refusal) throw verdict.refusal;
    adoptKind = verdict.adopt;
  }

  let src = null;
  if (body.videoUid) {
    // The id goes into Cloudflare API paths below, so its shape is checked
    // before anything else is done with it (security round, 2026-10-26).
    if (!VIDEO_UID_PATTERN.test(String(body.videoUid))) throw new ShowError('That doesn’t look like a video id from this site.');
    src = cloudflarePlaybackUrl(body.videoUid);
    if (!src) throw new ShowError('Could not resolve the uploaded video — is Cloudflare Stream fully configured?', 500);
    // A hand-typed video id isn't proof of anything: re-checked against
    // Cloudflare, like manual episode entry and house ads.
    if (body.videoIdWasManuallyEntered) {
      const status = await getCloudflareVideoStatus(body.videoUid);
      if (!status || !status.readyToStream) throw new ShowError('That video ID isn’t ready to stream yet in Cloudflare — wait for it to finish processing.');
    }
    // Whatever the browser says about where the id came from, it has to be
    // this creator's video (lib/videoOwnership.js).
    if (!isAdmin) {
      const owned = await checkVideoOwnership(body.videoUid, { userId });
      if (!owned.ok) throw new ShowError(owned.error, owned.status);
    }
  }

  // The trailer is optional; same ownership rule as the video.
  let trailerSrc = null;
  if (body.trailerUid) {
    if (!VIDEO_UID_PATTERN.test(String(body.trailerUid))) throw new ShowError('Trailer: that doesn’t look like a video id from this site.');
    if (!isAdmin) {
      const ownedTrailer = await checkVideoOwnership(body.trailerUid, { userId });
      if (!ownedTrailer.ok) throw new ShowError(`Trailer: ${ownedTrailer.error}`, ownedTrailer.status);
    }
    trailerSrc = cloudflarePlaybackUrl(body.trailerUid);
    if (!trailerSrc) throw new ShowError('Could not resolve the uploaded trailer — is Cloudflare Stream fully configured?', 500);
    if (body.trailerIdWasManuallyEntered) {
      const trailerStatus = await getCloudflareVideoStatus(body.trailerUid);
      if (!trailerStatus || !trailerStatus.readyToStream) throw new ShowError('That trailer video ID isn’t ready to stream yet in Cloudflare.');
    }
  }

  // Its number in the show: the one typed when it's free (a number
  // another episode keeps answers 409 with the holder and the next free
  // one: the page offers "Use E4 | Swap"), else the next free one — one
  // past the highest, never a gap filled by itself (decision 10). A new
  // show starts from the number typed, else 1.
  let seriesOrder = null;
  let numberPicked = false;
  if (numbered) {
    if (show) {
      if (typed !== null) {
        const slot = slotCheck(slotRows, { season, number: typed });
        if (!slot.free) throw slotTaken(slot, season, typed);
        seriesOrder = typed;
      } else {
        seriesOrder = nextFreeNumber(slotRows, season);
        numberPicked = true;
      }
    } else {
      seriesOrder = typed || 1;
      numberPicked = typed === null;
    }
  }

  // A stable, URL-safe id derived from the title.
  let id = mintTitleId(body.title, { fallback: 'title' });

  // Poster and thumbnail are optional; a file that can't be stored fails
  // the whole submission so the creator finds out now.
  let poster = null;
  let thumbnail = null;
  try {
    [poster, thumbnail] = await Promise.all([
      uploadArtworkImage({ base64: body.posterBase64, fileName: body.posterFileName, pathPrefix: `${id}-poster` }),
      uploadArtworkImage({ base64: body.thumbnailBase64, fileName: body.thumbnailFileName, pathPrefix: `${id}-thumbnail` })
    ]);
  } catch (err) {
    // A storage failure is marked internal (lib/artworkUpload.js): the
    // route logs it and answers plainly. A file that's too big or not an
    // image is the person's to fix.
    if (err && err.internal) throw err;
    throw new ShowError((err && err.message) || 'Could not store the artwork.', 400);
  }

  // Captions with the submission (optional; SRT is converted, VTT checked).
  let captionsUrl = null;
  if (body.captionsBase64) {
    try {
      const track = await uploadCaptionFile({ base64: body.captionsBase64, fileName: body.captionsFileName, pathPrefix: id });
      captionsUrl = track ? track.url : null;
    } catch (err) {
      await orphanArtwork([poster, thumbnail], 'submission failed (captions)', body.title);
      if (err && err.internal) throw err;
      // lib/captionUpload.js wraps a storage failure's own text in this
      // line; that text names internals, so it stays in the log.
      if (/^Could not upload captions/.test((err && err.message) || '')) {
        console.error('submitDraft captions:', err.message);
        throw new ShowError('Could not store the captions — try again.', 500);
      }
      throw new ShowError(`Captions: ${(err && err.message) || 'that file couldn’t be read.'}`);
    }
  }

  // "+ New show": only now, with everything checked. Its defaults are this
  // first episode's choices; it waits private until it is made public.
  let newShow = null;
  if (makesShow) {
    try {
      newShow = await createShow({
        name: newSeriesName,
        description: body.newSeriesDescription,
        kind: body.contentType === 'podcast' ? 'podcast' : 'series',
        defaults: { tier: body.tier, rating: body.rating, mainGenre: body.mainGenre, genre: body.genre, artist: body.artist, adsEnabled: body.adsEnabled !== false },
        creatorId: userId,
        submittedBy: email,
        submittedByUserId: userId
      });
    } catch (err) {
      await orphanArtwork([poster, thumbnail], 'submission failed (new show)', body.title);
      if (err instanceof ShowError) throw err;
      console.error('submitDraft new show:', err.message);
      throw new ShowError('Could not create the show.', 500);
    }
  }
  const seriesId = makesShow ? newShow.id : targetsShow ? show.id : null;

  const row = {
    id,
    title: body.title,
    description: body.description,
    tier: body.tier,
    genre: body.genre,
    main_genre: body.mainGenre,
    content_type: body.contentType,
    series_id: numbered ? seriesId : null,
    season: numbered ? season : null,
    series_order: numbered ? seriesOrder : null,
    bonus_parent_type: body.contentType === 'bonus' ? 'series' : null,
    bonus_parent_id: body.contentType === 'bonus' ? seriesId : null,
    artist: body.artist,
    runtime: body.runtime,
    rating: blank(body.rating) ? null : body.rating,
    release_year: body.releaseYear && Number.isInteger(Number(body.releaseYear)) ? Number(body.releaseYear) : null,
    video_type: 'html5',
    src,
    audio_url: body.audioUrl || null,
    audio_bytes: body.audioBytes || null,
    trailer_src: trailerSrc,
    poster,
    thumbnail,
    ...(captionsUrl ? { captions_url: captionsUrl, captions_language: typeof body.captionsLanguage === 'string' ? body.captionsLanguage.slice(0, 10) || 'en' : 'en', captions_label: typeof body.captionsLabel === 'string' ? body.captionsLabel.slice(0, 40) || 'English' : 'English' } : {}),
    // A creator's ticks here don't bypass review: the title is pending
    // whatever they ask for.
    featured: !!body.featured,
    ads_enabled: body.adsEnabled !== false,
    ad_break_seconds: Array.isArray(body.adBreakSeconds) && body.adBreakSeconds.length > 0 ? body.adBreakSeconds : [0],
    is_original: !!body.isOriginal,
    funding_url: typeof body.fundingUrl === 'string' && body.fundingUrl.trim() ? normalizeUrl(body.fundingUrl) : null,
    // Off unless the creator ticked "Let channels air this" — see
    // lib/channelEngine.js for what opting in allows.
    channel_opt_in: body.channelOptIn === true,
    status: 'pending',
    submitted_by: userId
  };

  const positionTaken = (err) => Boolean(err) && err.code === '23505' && /episodes_show_position_uq/.test(err.message || '');
  let { error } = await supabase.from('episodes').insert(row);
  // Under migration 118's unique index a number can be taken between the
  // check and the write (another send at the same moment); a number we
  // picked moves on to the next free one. Two ids minted in the same
  // millisecond on two servers for one title would collide on the key:
  // that one simply gets a new id.
  for (let attempt = 0; error && error.code === '23505' && attempt < 3; attempt += 1) {
    if (positionTaken(error) && numberPicked && row.series_id) {
      slotRows = await showSlotRows(row.series_id);
      row.series_order = nextFreeNumber(slotRows, season);
      seriesOrder = row.series_order;
    } else if (/episodes_pkey/.test(error.message || '')) {
      id = mintTitleId(body.title, { fallback: 'title' });
      row.id = id;
    } else {
      break;
    }
    ({ error } = await supabase.from('episodes').insert(row));
  }
  if (error) {
    if (newShow) await getSupabase().from('series').delete().eq('id', newShow.id).then(() => {}, () => {});
    await orphanArtwork([poster, thumbnail], 'submission failed', body.title);
    if (positionTaken(error) && show) {
      const slot = slotCheck(await showSlotRows(show.id), { season, number: seriesOrder });
      throw slotTaken(slot, season, seriesOrder);
    }
    console.error('submit-episode error:', error.message);
    throw new ShowError('Could not save the submission.', 500);
  }

  // A show with no episode yet takes its kind from its first one (see
  // showTakes); best effort — the episode is in either way.
  if (adoptKind && show) {
    const { error: kindError } = await supabase.from('series').update({ kind: adoptKind }).eq('id', show.id);
    if (kindError) console.error('submitDraft show kind:', kindError.message);
    else if (show.status === 'approved') await invalidateCache('all_series_approved_v1');
  }

  // The draft this came from is done; its video rides on with the title.
  if (body.draftId) await deleteDraft(userId, String(body.draftId), { keepMedia: true }).catch(() => {});

  return {
    ok: true,
    id,
    status: 'pending',
    // The show it went into (an extra's too); a film or a short has none.
    seriesId: row.series_id || row.bonus_parent_id || null,
    season,
    seriesOrder,
    numberPicked,
    newShow: newShow ? { id: newShow.id, name: newShow.name } : null
  };
}

async function orphanArtwork(urls, reason, context) {
  for (const url of urls) {
    const path = storagePathFromUrl(url || '');
    if (path) await recordOrphan({ kind: 'storage_image', reference: path, reason, context: context ? String(context).slice(0, 200) : null });
  }
}

// --- renumbering -----------------------------------------------------------------

// The functions' refusals (SQLSTATE 22023 → PostgREST 400, 23505 → 409),
// in the page's words. Their own text names ids, so it is never echoed.
function rpcError(error, context) {
  const code = error && error.code;
  const msg = String((error && error.message) || '');
  if (code === '22023') {
    if (/listed twice|missing or listed/i.test(msg)) return new ShowError('An episode is listed twice.');
    if (/run from 1 to/i.test(msg)) return new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    if (/same number/i.test(msg)) return new ShowError('Two episodes were given the same number.');
    if (/episodes but .* numbers/i.test(msg)) return new ShowError('Every episode needs its number.');
    if (/seasons are numbered/i.test(msg)) return new ShowError('Seasons are numbered from 1.');
    if (/there is no show/i.test(msg)) return new ShowError('That show isn’t there any more.', 404);
    if (/there is no episode/i.test(msg)) return new ShowError('That episode isn’t there any more.', 404);
    if (/is a .* episode and .* is a .* show/i.test(msg)) return new ShowError('An episode only goes into a show of its own kind.');
    if (/not a series or podcast episode/i.test(msg)) return new ShowError('Only a series or podcast episode has a place in a show.');
    if (/has no place to move/i.test(msg)) return new ShowError('Send it again for review before it takes a place.');
    if (/outside the running order/i.test(msg)) return new ShowError('That number sits outside the running order — give it its own number first.');
    if (/ is not in |not in .* season/i.test(msg)) return new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
    return new ShowError('That doesn’t fit the show any more — reload it and try again.');
  }
  if (code === '23505') {
    const held = /E(\d+)/.exec(msg);
    return new ShowError(held ? `E${held[1]} is taken — reload the show and try again.` : 'That number is taken — reload the show and try again.', 409, { code: 'taken' });
  }
  return internalError(error, context);
}

function shapeMoveRow(r) {
  return {
    id: r.id,
    seriesId: r.series_id ?? null,
    season: r.season ?? null,
    number: r.series_order ?? null,
    fromSeriesId: r.old_series_id ?? null,
    fromSeason: r.old_season ?? null,
    fromNumber: r.old_series_order ?? null
  };
}

function cleanWrites(list, label) {
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    const id = w && typeof w.id === 'string' ? w.id : null;
    const number = w ? posInt(w.number) : null;
    if (!id || !isTitleId(id)) throw new ShowError(`Which ${label}?`);
    if (!number || number > MAX_EPISODE_NUMBER) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);
    if (out.some((x) => x.id === id)) throw new ShowError('An episode is listed twice.');
    out.push({ id, number });
  }
  return out;
}

// One write per row, all at once; every row lands on its own number, so
// the order inside a phase doesn't matter.
async function writeNumbers(seriesIdForCheck, writes) {
  const supabase = getSupabase();
  const results = await Promise.all(writes.map((w) => {
    const patch = { series_order: w.number };
    if (w.season !== undefined) patch.season = w.season;
    if (w.seriesId !== undefined) patch.series_id = w.seriesId;
    let q = supabase.from('episodes').update(patch).eq('id', w.id);
    if (w.fromSeriesId) q = q.eq('series_id', w.fromSeriesId);
    else if (seriesIdForCheck) q = q.eq('series_id', seriesIdForCheck);
    return q;
  }));
  const failed = results.find((r) => r && r.error);
  if (failed) throw failed.error.code === '23505' ? rpcError(failed.error, 'renumber') : internalError(failed.error, 'renumber');
}

// Renumbers rows of one season of a show (decision 5: "E7 → E3; E3–E6
// become E4–E7"). `episodes` and `drafts` are planMove's same-season
// shape ({ id, number } each, amendment 14): the episodes go through
// reorder_show_season in one transaction (or, before migration 118, the
// same two phases in JS — answered `fallback: true`), then the drafts'
// forms take their numbers. Every episode must be in that show and season,
// and no number may be one another episode of the season holds. Who may
// do it is the route's business (the show's owner, or manage_episodes);
// `draftOwners` limits which accounts' drafts may be renumbered (null =
// any, for the team).
//   → { ok, fallback, rows: [{ id, seriesId, season, number, fromSeriesId,
//       fromSeason, fromNumber }], drafts: [{ id, number }] }
export async function reorderShowSeason(seriesId, { season = null, episodes = [], drafts = [] } = {}, { draftOwners = null } = {}) {
  if (!isTitleId(String(seriesId || ''))) throw new ShowError('Which show?', 400);
  const s = season === null || season === undefined || season === '' ? null : posInt(season);
  if (season !== null && season !== undefined && season !== '' && !s) throw new ShowError('Seasons are numbered from 1.');
  const eps = cleanWrites(episodes, 'episode');
  const dfs = cleanWrites(drafts, 'draft');
  const numbers = [...eps, ...dfs].map((w) => w.number);
  if (new Set(numbers).size !== numbers.length) throw new ShowError('Two episodes were given the same number.');
  if (eps.length === 0 && dfs.length === 0) return { ok: true, fallback: false, rows: [], drafts: [] };

  const supabase = getSupabase();
  // A draft may not land on a number an episode of the season keeps.
  if (dfs.length > 0) {
    let q = supabase.from('episodes').select('id, series_order, status, content_type, withdrawn_at').eq('series_id', seriesId);
    q = s === null ? q.is('season', null) : q.eq('season', s);
    const { data, error } = await q;
    if (error) throw internalError(error, 'reorder drafts check');
    const moving = new Map(eps.map((e) => [e.id, e.number]));
    const kept = (data || []).filter((r) => inRunningOrder(r)).map((r) => (moving.has(r.id) ? moving.get(r.id) : r.series_order)).filter((n) => n !== null && n !== undefined);
    const clash = dfs.find((d) => kept.includes(d.number));
    if (clash) throw new ShowError(`E${clash.number} is taken — reload the show and try again.`, 409, { code: 'taken' });
  }

  let rows = [];
  let fallback = false;
  if (eps.length > 0) {
    const { data, error } = await supabase.rpc('reorder_show_season', {
      p_series_id: seriesId,
      p_season: s,
      p_ids: eps.map((e) => e.id),
      p_numbers: eps.map((e) => e.number)
    });
    if (error && isMissingFunction(error)) {
      rows = await reorderFallback(seriesId, s, eps);
      fallback = true;
    } else if (error) {
      throw rpcError(error, 'reorder_show_season');
    } else {
      rows = Array.isArray(data) ? data : [];
    }
    await invalidateCache('public_episodes_v1');
  }
  const draftRows = dfs.length > 0 ? await renumberDrafts(seriesId, s, dfs, draftOwners) : [];
  return { ok: true, fallback, rows: rows.map(shapeMoveRow), drafts: draftRows };
}

// reorder_show_season's checks and its two phases, in JS.
async function reorderFallback(seriesId, season, eps) {
  const supabase = getSupabase();
  let q = supabase.from('episodes').select('id, series_id, season, series_order, content_type, status, withdrawn_at').eq('series_id', seriesId);
  q = season === null ? q.is('season', null) : q.eq('season', season);
  const { data, error } = await q;
  if (error) throw internalError(error, 'reorder fallback');
  const rows = data || [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (eps.some((e) => !byId.has(e.id))) throw new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
  const listed = new Set(eps.map((e) => e.id));
  const covered = (r) => NUMBERED_TYPES.includes(r.content_type) && r.status !== 'rejected' && !r.withdrawn_at;
  for (const e of eps) {
    if (!covered(byId.get(e.id))) continue;
    if (rows.some((o) => !listed.has(o.id) && covered(o) && o.series_order === e.number)) {
      throw new ShowError(`E${e.number} is taken — reload the show and try again.`, 409, { code: 'taken' });
    }
  }
  await twoPhase(seriesId, rows, eps.map((e) => ({ id: e.id, number: e.number })));
  return eps.map((e) => {
    const was = byId.get(e.id);
    return { id: e.id, series_id: seriesId, season, series_order: e.number, old_series_id: seriesId, old_season: season, old_series_order: was.series_order ?? null };
  });
}

// Out of the way (below the lowest number in sight, or none for the row
// that moves), then into place; on a failure in the second phase, back to
// where they were the same way.
async function twoPhase(seriesId, scopeRows, writes, { nullIds = [] } = {}) {
  const floor = Math.min(0, ...scopeRows.map((r) => (Number.isInteger(r.series_order) ? r.series_order : 0)));
  const aside = writes.map((w, i) => ({ id: w.id, number: nullIds.includes(w.id) ? null : floor - (i + 1), fromSeriesId: w.fromSeriesId }));
  await writeNumbers(seriesId, aside);
  try {
    await writeNumbers(seriesId, writes);
  } catch (err) {
    const before = new Map(scopeRows.map((r) => [r.id, r]));
    const back = writes.map((w) => {
      const r = before.get(w.id) || {};
      return { id: w.id, number: r.series_order ?? null, season: r.season ?? null, seriesId: r.series_id ?? null };
    });
    try {
      await writeNumbers(null, back.map((w, i) => ({ id: w.id, number: floor - writes.length - (i + 1) })));
      await writeNumbers(null, back);
    } catch (restoreErr) {
      console.error('renumber restore failed:', restoreErr.message);
    }
    throw err;
  }
}

// The drafts' numbers live in their forms (creator_drafts, migration 116).
async function renumberDrafts(seriesId, season, dfs, draftOwners) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('creator_drafts').select('id, user_id, form').in('id', dfs.map((d) => d.id));
  if (error) {
    if (isMissingDraftsTable(error)) throw new ShowError('Drafts aren’t set up yet on this database (migration 116).', 503);
    throw internalError(error, 'renumber drafts');
  }
  const byId = new Map((data || []).map((d) => [d.id, d]));
  for (const d of dfs) {
    const row = byId.get(d.id);
    const form = row && row.form && typeof row.form === 'object' ? row.form : null;
    if (!form || String(form.seriesId || '') !== String(seriesId)) throw new ShowError('One of those drafts isn’t in this show any more — reload the show.');
    if ((posInt(form.season) || 1) !== (season || 1)) throw new ShowError('One of those drafts isn’t in that season any more — reload the show.');
    if (Array.isArray(draftOwners) && !draftOwners.includes(row.user_id)) throw new ShowError('That draft isn’t yours to renumber.', 403);
  }
  const results = await Promise.all(dfs.map((d) => {
    const row = byId.get(d.id);
    return supabase.from('creator_drafts').update({ form: { ...row.form, seriesOrder: String(d.number) }, updated_at: new Date().toISOString() }).eq('id', d.id);
  }));
  const failed = results.find((r) => r && r.error);
  if (failed) throw internalError(failed.error, 'renumber drafts');
  return dfs.map((d) => ({ id: d.id, number: d.number }));
}

// Moves one episode inside its show (another season, a number) or to
// another show of the same kind, through move_episode — or, before
// migration 118, lib/showRules.js planMove's writes in the same two phases
// (move_episode was written to match planMove). fromSeriesId is the show
// the route acts for (the episode must be in it now). season null = its
// own season (1 in another show); number null = the end of that season; a
// taken number is refused (409) unless shift, which inserts it there and
// moves the rest along; closeGap closes the place it leaves. Who may do it
// (lib/showRules.js canMoveTo) is the route's business.
//   → { ok, fallback, rows: [{ id, seriesId, season, number, fromSeriesId,
//       fromSeason, fromNumber }] } (the moved episode first)
export async function moveShowEpisode({ episodeId, fromSeriesId, toSeriesId = null, season = null, number = null, shift = false, closeGap = false } = {}) {
  if (!isTitleId(String(episodeId || ''))) throw new ShowError('Which episode?');
  if (!isTitleId(String(fromSeriesId || ''))) throw new ShowError('Which show?');
  const target = toSeriesId ? String(toSeriesId) : String(fromSeriesId);
  if (!isTitleId(target)) throw new ShowError('Which show?');
  const s = blank(season) ? null : posInt(season);
  if (!blank(season) && !s) throw new ShowError('Seasons are numbered from 1.');
  const n = blank(number) ? null : posInt(number);
  if (!blank(number) && (!n || n > MAX_EPISODE_NUMBER)) throw new ShowError(`Episode numbers run from 1 to ${MAX_EPISODE_NUMBER}.`);

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('move_episode', {
    p_id: String(episodeId),
    p_series_id: target,
    p_season: s,
    p_number: n,
    p_shift: shift === true,
    p_from_series_id: String(fromSeriesId),
    p_close_gap: closeGap === true
  });
  let rows;
  let fallback = false;
  if (error && isMissingFunction(error)) {
    rows = await moveFallback({ episodeId: String(episodeId), fromSeriesId: String(fromSeriesId), toSeriesId: target, season: s, number: n, shift: shift === true, closeGap: closeGap === true });
    fallback = true;
  } else if (error) {
    throw rpcError(error, 'move_episode');
  } else {
    rows = Array.isArray(data) ? data : [];
  }
  if (rows.some((r) => r.series_order !== r.old_series_order || r.season !== r.old_season || r.series_id !== r.old_series_id)) await invalidateCache('public_episodes_v1');
  return { ok: true, fallback, rows: rows.map(shapeMoveRow) };
}

// move_episode's checks in JS, then planMove's writes.
async function moveFallback({ episodeId, fromSeriesId, toSeriesId, season, number, shift, closeGap }) {
  const supabase = getSupabase();
  const shows = [...new Set([fromSeriesId, toSeriesId])];
  const [{ data: eps, error }, { data: me, error: meError }, { data: targetShow, error: showError }] = await Promise.all([
    supabase.from('episodes').select('id, title, series_id, season, series_order, content_type, status, withdrawn_at, created_at').in('series_id', shows),
    supabase.from('episodes').select('id, series_id, content_type, status, withdrawn_at').eq('id', episodeId).maybeSingle(),
    supabase.from('series').select('*').eq('id', toSeriesId).maybeSingle()
  ]);
  if (error || meError || showError) throw internalError(error || meError || showError, 'move fallback');
  if (!me) throw new ShowError('That episode isn’t there any more.', 404);
  if (me.series_id !== fromSeriesId) throw new ShowError('One of those episodes isn’t in that season of this show any more — reload the show.');
  if (!NUMBERED_TYPES.includes(me.content_type)) throw new ShowError('Only a series or podcast episode has a place in a show.');
  if (me.status === 'rejected' || me.withdrawn_at) throw new ShowError('Send it again for review before it takes a place.');
  if (!targetShow) throw new ShowError('That show isn’t there any more.', 404);
  const rows = eps || [];
  if (toSeriesId !== fromSeriesId) {
    const targetKind = SHOW_KINDS.includes(targetShow.kind) ? targetShow.kind : kindFromEpisodes(rows.filter((r) => r.series_id === toSeriesId));
    if (targetKind !== me.content_type) throw new ShowError('An episode only goes into a show of its own kind.');
  }
  const target = {
    ...(toSeriesId !== fromSeriesId ? { seriesId: toSeriesId } : {}),
    ...(season !== null ? { season } : {}),
    ...(number !== null ? { number, ...(shift ? { mode: 'insert' } : {}) } : {})
  };
  const plan = planMove(rows, episodeId, target, { closeGap });
  if (!plan.ok) {
    if (plan.code === 'taken') throw new ShowError(`${plan.reason} — pick another number, or insert it there.`, 409, { code: 'taken', holder: plan.holder || null });
    if (plan.code === 'missing') throw new ShowError('That episode isn’t there any more.', 404);
    throw new ShowError(plan.reason || 'That doesn’t fit the show any more — reload it and try again.');
  }
  const before = new Map(rows.map((r) => [r.id, r]));
  if (!plan.writes.length) {
    const r = before.get(episodeId);
    return [{ id: r.id, series_id: r.series_id, season: r.season, series_order: r.series_order, old_series_id: r.series_id, old_season: r.season, old_series_order: r.series_order }];
  }
  const writes = plan.writes.filter((w) => w.kind === 'episode').map((w) => ({
    id: w.id,
    number: w.number,
    season: w.season,
    ...(w.seriesId ? { seriesId: w.seriesId } : {}),
    fromSeriesId: before.get(w.id) ? before.get(w.id).series_id : null
  }));
  await twoPhase(null, rows, writes, { nullIds: [episodeId] });
  const ordered = [...writes].sort((a, b) => (a.id === episodeId ? -1 : b.id === episodeId ? 1 : 0));
  return ordered.map((w) => {
    const was = before.get(w.id) || {};
    return { id: w.id, series_id: w.seriesId || was.series_id || null, season: w.season, series_order: w.number, old_series_id: was.series_id ?? null, old_season: was.season ?? null, old_series_order: was.series_order ?? null };
  });
}

// --- making a show public (decision 2) -----------------------------------------------

// The show's owner or a full admin makes a private show public once at
// least one of its episodes is approved (lib/showRules.js canMakePublic).
// One-way, and it is the release: the approved episodes' released_at
// starts again now, so Premium's early screening and the "New episode"
// banner start from this moment. One notification to the owner, one audit
// line, both catalogue caches invalidated. public_at is a 118 column
// (dropped before it has run). actor = { userId, email, isAdmin }.
//   → { ok, id, publicAt, released: [episode ids] }
export async function makeShowPublic(seriesId, actor = {}) {
  if (!isTitleId(String(seriesId || ''))) throw new ShowError('Which show?');
  const show = await readShowRow(String(seriesId), 'makeShowPublic series');
  const { rows } = show ? await selectEpisodes((q) => q.eq('series_id', show.id), 'makeShowPublic episodes') : { rows: [] };
  const verdict = canMakePublic(show, rows, { userId: actor && actor.userId, isAdmin: Boolean(actor && actor.isAdmin === true) });
  if (!verdict.ok) {
    const status = verdict.code === 'missing' ? 404 : verdict.code === 'who' ? 403 : 409;
    throw new ShowError(verdict.reason, status, { code: verdict.code });
  }
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data: changed, error } = await updateCompat(supabase, 'series', { status: 'approved', public_at: now }, ['public_at'], (q) => q.eq('id', show.id).eq('status', 'pending').select('id'));
  if (error) throw internalError(error, 'makeShowPublic');
  if (!changed || changed.length === 0) throw new ShowError('It went public a moment ago — reload the page.', 409, { code: 'public' });
  if (verdict.releaseIds.length > 0) {
    const { error: releaseError } = await updateCompat(supabase, 'episodes', { released_at: now }, ['released_at'], (q) => q.in('id', verdict.releaseIds));
    if (releaseError) console.error('makeShowPublic released_at:', releaseError.message);
  }
  await Promise.all([invalidateCache('all_series_approved_v1'), invalidateCache('public_episodes_v1')]);
  const byOwner = Boolean(actor && actor.userId && actor.userId === show.creator_id);
  const count = verdict.releaseIds.length;
  await recordAudit({
    adminId: actor && actor.userId ? actor.userId : 'unknown',
    adminEmail: actor && actor.email ? actor.email : null,
    action: 'show_live',
    targetType: 'series',
    targetId: show.id,
    details: `${show.name || show.id}: public, ${count} episode${count === 1 ? '' : 's'} released (${byOwner ? 'by the owner' : 'by an admin'})`
  });
  if (show.creator_id) {
    await notifyCreator({
      userId: show.creator_id,
      type: 'show_live',
      message: `"${show.name || 'Your show'}" is public: ${count} episode${count === 1 ? ' is' : 's are'} on the site.`,
      href: `/creator/show/${encodeURIComponent(show.id)}`
    });
  }
  return { ok: true, id: show.id, publicAt: now, released: verdict.releaseIds };
}
