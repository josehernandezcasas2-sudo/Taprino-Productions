import { getSupabase } from './supabase';
import { syncStreamProtection } from './streamProtection';
import { hasCapability } from './capabilities';
import { getPendingAds, reviewAdvertiserAd } from './adAccounts';
import { listChannelMedia, reviewChannelMedia } from './channelMedia';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { invalidateCache } from './redis';
import { getSiteSettings } from './siteSettings';
import { listPendingListings, reviewListing } from './locations';
import { OWNERSHIP } from './locationRules';
import { listPendingPrices, decidePrice } from './purchases';
import { listApplicationsForQueue, acceptApplication, holdApplication, declineApplication } from './creatorApplications';
import { cutArtworkFromVideo } from './artworkFromFilm';
import { cloudflareUidFromUrl } from './cloudflareUpload';
import { ShowError, protectTrailers, realName, videoStateFor } from './showPage';
import { approvalBlocker, episodeDisplayTitle, inRunningOrder, isPublicShow, kindOf, masterReady, masterState, showDefaults } from './showRules';
import { sortEpisodes } from './seriesResume';
import { getPublicIdentities } from './userProfiles';
import { accountAgeDays } from './accountAge';
import { signedVideoMedia } from './stagedChanges';
import { approveShowEpisodes, rejectShowEpisodes } from './showAdmin';

// One merged "needs your review" queue: creator submissions, advertiser
// ads, channel uploads, places, prices and applications. Feeds the admin
// dashboard (components/admin/ReviewQueue.js), /admin/review, and the
// mobile app's review-on-the-go screens, through /api/admin/review-queue.
//
// Every item is normalised to the same shape so one card component can
// render any of them:
//   { kind, id, title, subtitle, description, createdAt, media: { src,
//     poster }, meta: { ... kind-specific }, actions: ['approve','reject'] }
//
// Decisions reuse the same library calls the per-kind API routes make,
// so approving from here is identical to approving from the old hub. A
// show's episode is approved or sent back through lib/showAdmin.js
// (approveShowEpisodes / rejectShowEpisodes), the same path as the admin
// show page, so the slot, the number and the master are checked there.
//
// The 'series' kind (a show ready to go public) was the queue's stand-in
// for Make it public until the show pages brought the real button (the
// series revamp, slices 2 and 3a). It is gone: Make it public is the
// owner's moment (decision 2), pressed on the show page, and the Shows
// list's "Ready to go public" filter finds them. Slice 3a kept a decision
// branch for it one release for a stale bundle; slice 6 removed it, so a
// 'series' decision is refused like any other unknown kind (400).

export const QUEUE_KINDS = ['submission', 'ad', 'channel', 'location', 'price', 'application'];
export const DECIDABLE_KINDS = QUEUE_KINDS;

// How much one read does for submissions: Cloudflare is asked about at
// most this many masters (the rest read as unknown, which doesn't block),
// at most this many are signed (the rest open on their show page), and
// the account age of at most this many owners is looked up.
const STATES_PER_READ = 40;
const SIGNED_PER_READ = 100;
const AGES_PER_READ = 20;
const IN_CHUNK = 100;

const TYPE_LABEL = { movie: 'Film', short: 'Short', series: 'Series', podcast: 'Podcast', vertical: 'Vertical', bonus: 'Extra' };

function minutesOf(runtime) {
  const parts = String(runtime || '').trim().split(':').map((x) => Number(x));
  if (parts.length < 2 || parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return seconds > 0 ? `${Math.max(1, Math.round(seconds / 60))} min` : null;
}

function codeOf(row) {
  const n = Number(row.series_order);
  if (!Number.isInteger(n) || n <= 0) return null;
  const s = Number(row.season);
  return `S${Number.isInteger(s) && s > 0 ? s : 1} E${n}`;
}

function isShowEpisode(row) {
  return Boolean(row && row.series_id) && row.content_type !== 'bonus';
}

function stageOf(show, rows) {
  if (show.moderation_hold) return 'pulled';
  if (show.deletion_requested) return 'removal';
  if (isPublicShow(show)) return 'live';
  return rows.some((e) => e.status === 'approved' && inRunningOrder(e)) ? 'private' : 'new';
}

function defaultsLine(show) {
  const d = showDefaults(show);
  const parts = [d.tier === 'premium' ? 'Tapa +' : d.tier === 'free' ? 'Free' : null, d.rating || null, d.mainGenre || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

async function inParallel(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

// What a submission card needs beyond its row: its show and the show's
// rows (for the slot and "11 more waiting"), names, the owner's account
// age, Cloudflare's word on the master and a signed player.
async function submissionContext(supabase, rows) {
  const showIds = [...new Set(rows.filter(isShowEpisode).map((r) => r.series_id))];
  const shows = new Map();
  const showRows = new Map(showIds.map((id) => [id, []]));
  for (let i = 0; i < showIds.length; i += IN_CHUNK) {
    const part = showIds.slice(i, i + IN_CHUNK);
    const seriesRes = await supabase.from('series').select('*').in('id', part);
    if (seriesRes.error) console.error('review queue shows:', seriesRes.error.message);
    for (const s of seriesRes.data || []) shows.set(s.id, s);
    // Paged: PostgREST stops at 1,000 rows without a word, and a show left
    // short would get the wrong numbers and slot lines.
    for (let from = 0; ; from += 1000) {
      const epsRes = await supabase.from('episodes').select('id, title, series_id, season, series_order, status, content_type, withdrawn_at, created_at, moderation_hold, deletion_requested').in('series_id', part).order('id', { ascending: true }).range(from, from + 999);
      if (epsRes.error) {
        console.error('review queue show rows:', epsRes.error.message);
        break;
      }
      for (const e of epsRes.data || []) if (showRows.has(e.series_id)) showRows.get(e.series_id).push(e);
      if (!epsRes.data || epsRes.data.length < 1000) break;
    }
  }
  const people = [...new Set([...rows.map((r) => r.submitted_by), ...[...shows.values()].map((s) => s.creator_id)].filter(Boolean))];
  const owners = [...new Set([...shows.values()].map((s) => s.creator_id).filter(Boolean))].slice(0, AGES_PER_READ);
  const [identities, ages] = await Promise.all([
    getPublicIdentities(people).catch(() => ({})),
    inParallel(owners, 10, (id) => accountAgeDays(id).catch(() => null))
  ]);
  const ageOf = new Map(owners.map((id, i) => [id, ages[i]]));
  const ask = rows.map((r) => ({ id: r.id, uid: cloudflareUidFromUrl(r.src || '') })).filter((x) => x.uid).slice(0, STATES_PER_READ);
  const answers = await inParallel(ask, 10, (x) => videoStateFor(x.uid).catch(() => null));
  const states = new Map();
  ask.forEach((x, i) => { if (answers[i]) states.set(x.id, answers[i]); });
  const toSign = rows.filter((r) => cloudflareUidFromUrl(r.src || '') && masterReady(r, states.get(r.id) || undefined)).slice(0, SIGNED_PER_READ);
  const signed = await inParallel(toSign, 10, (r) => signedVideoMedia(r.src).catch(() => null));
  const media = new Map(toSign.map((r, i) => [r.id, signed[i]]));
  const nameOf = (id) => realName(id && identities[id] ? identities[id].displayName : null);
  return { shows, showRows, states, media, nameOf, ageOf };
}

function submissionItem(s, ctx) {
  const show = isShowEpisode(s) ? ctx.shows.get(s.series_id) || null : null;
  const rows = show ? ctx.showRows.get(show.id) || [] : [];
  const state = ctx.states.get(s.id);
  const master = masterState(s, state || undefined);
  const ready = masterReady(s, state || undefined);
  const blocker = approvalBlocker(s, { slotRows: rows, state: state || undefined, show });
  const uploader = ctx.nameOf(s.submitted_by);
  const minutes = minutesOf(s.runtime);
  const position = show ? codeOf(s) : null;
  const subtitle = show
    ? [show.name || 'A show', position, minutes, uploader].filter(Boolean).join(' · ')
    : [TYPE_LABEL[s.content_type] || null, s.genre || s.main_genre || null, minutes, uploader].filter(Boolean).join(' · ');
  const poster = s.poster || s.thumbnail || (show ? show.poster || show.thumbnail || null : null);
  let media;
  if (ctx.media.has(s.id)) {
    const m = ctx.media.get(s.id);
    media = { src: m ? m.src : null, iframe: m ? m.iframe : null, poster };
  } else if (!s.src && s.audio_url) {
    media = { src: null, audio: s.audio_url, poster };
  } else if (s.src && !cloudflareUidFromUrl(s.src)) {
    media = { src: s.src, poster };
  } else {
    media = { src: null, poster };
  }
  const meta = {
    contentType: s.content_type,
    genre: s.genre,
    runtime: s.runtime,
    artist: s.artist,
    tier: s.tier,
    rating: s.rating || null,
    hasCaptions: Boolean(s.captions_url),
    position,
    slot: null,
    master,
    masterReady: ready,
    blocked: blocker ? blocker.error : null
  };
  if (s.src && cloudflareUidFromUrl(s.src) && !ctx.media.has(s.id)) meta.openOnShowPage = true;
  if (show) {
    const stage = stageOf(show, rows);
    const ownerName = ctx.nameOf(show.creator_id);
    const age = ctx.ageOf.get(show.creator_id);
    meta.show = {
      id: show.id,
      name: show.name || null,
      kind: kindOf(show, rows),
      stage,
      poster: show.poster || show.thumbnail || null,
      description: show.description || null,
      ownerId: show.creator_id || null,
      ownerName,
      ownerAccountAgeDays: age === null || age === undefined ? null : Math.floor(age),
      defaultsLine: defaultsLine(show),
      waitingCount: Math.max(0, rows.filter((e) => e.status === 'pending' && e.id !== s.id && e.content_type !== 'bonus').length),
      href: `/admin/shows/${encodeURIComponent(show.id)}`,
      makesPublic: stage === 'new' || stage === 'private' ? `${ownerName || 'Its owner'} makes the show public once one is approved.` : null
    };
    const slotProblem = blocker && (blocker.code === 'taken' || blocker.code === 'unnumbered') ? blocker : null;
    meta.slot = slotProblem ? { free: false, words: slotProblem.error } : position ? { free: true, words: `${position} · the number is free` } : null;
  }
  return {
    kind: 'submission',
    id: s.id,
    // A show's episode may be sent without a title (the show page's
    // drafts): it reads "Episode N" here as everywhere else.
    title: episodeDisplayTitle(s, show),
    subtitle,
    description: s.description || (show ? show.description || null : null),
    createdAt: s.created_at,
    media,
    meta,
    actions: ['approve', 'reject']
  };
}

// By createdAt, except a show's submissions sit together at the place of
// its oldest one, in play order (the page draws them under one header).
function queueOrder(items) {
  const anchor = new Map();
  const order = new Map();
  const byShow = new Map();
  for (const it of items) {
    const sid = it.kind === 'submission' && it.meta && it.meta.show ? it.meta.show.id : null;
    if (!sid) continue;
    if (!byShow.has(sid)) byShow.set(sid, []);
    byShow.get(sid).push(it);
    const at = it.createdAt || '';
    if (!anchor.has(sid) || at < anchor.get(sid)) anchor.set(sid, at);
  }
  for (const list of byShow.values()) {
    const sorted = sortEpisodes(list.map((it) => ({ id: it.id, season: it._season, series_order: it._number, created_at: it.createdAt })));
    sorted.forEach((r, i) => order.set(r.id, i));
  }
  const keyOf = (it) => {
    const sid = it.kind === 'submission' && it.meta && it.meta.show ? it.meta.show.id : null;
    return sid ? { at: anchor.get(sid) || '', group: sid, n: order.get(it.id) || 0 } : { at: it.createdAt || '', group: `~${it.kind}:${it.id}`, n: 0 };
  };
  return items
    .map((it) => ({ it, k: keyOf(it) }))
    .sort((a, b) => (a.k.at < b.k.at ? -1 : a.k.at > b.k.at ? 1 : a.k.group < b.k.group ? -1 : a.k.group > b.k.group ? 1 : a.k.n - b.k.n))
    .map(({ it }) => {
      delete it._season;
      delete it._number;
      return it;
    });
}

function canReview(rc) {
  return rc.isAdmin || hasCapability(rc, 'review_submissions') || hasCapability(rc, 'manage_applications');
}

// Applications (the creator path, 2026-10-31) are the manage_applications
// capability's; the rest of the queue is review_submissions'.
function canSeeApplications(rc) {
  return rc.isAdmin || hasCapability(rc, 'manage_applications');
}

function canSeeSubmissions(rc) {
  return rc.isAdmin || hasCapability(rc, 'review_submissions');
}

// opts.light (the nav's badge numbers, /api/admin/queue-counts): only the
// counts are wanted, so a submission isn't dressed (no show, names,
// Cloudflare states or signed players).
export async function listReviewQueue(rc, { light = false } = {}) {
  if (!canReview(rc)) return { items: [], counts: emptyCounts() };
  const supabase = getSupabase();
  const [subs, ads, channel, locations, prices, applications] = await Promise.all([
    canSeeSubmissions(rc) ? supabase.from('episodes').select('*').eq('status', 'pending').order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
    rc.isAdmin ? getPendingAds() : Promise.resolve([]),
    canSeeSubmissions(rc) ? listChannelMedia({ all: true, status: 'pending' }).catch(() => []) : Promise.resolve([]),
    rc.isAdmin ? listPendingListings().catch(() => []) : Promise.resolve([]),
    rc.isAdmin ? listPendingPrices().catch(() => []) : Promise.resolve([]),
    canSeeApplications(rc) ? listApplicationsForQueue().catch(() => []) : Promise.resolve([])
  ]);

  const items = [];
  // A film sent through /apply with its master: Accept puts it live (and
  // grants Creator Studio), Hold sends one thing to fix, Decline deletes
  // the file. The signed master plays in place once Cloudflare has it.
  for (const a of applications || []) {
    const videoLine = a.video
      ? (a.video.state === 'ready' ? `master in${a.video.runtime ? ` · ${a.video.runtime}` : ''}` : a.video.state === 'uploading' ? 'master still uploading' : a.video.state === 'error' ? 'master failed to process' : 'master processing')
      : (a.mediaLink ? 'linked to the files, no upload' : 'no file');
    items.push({
      kind: 'application',
      id: a.id,
      title: a.title,
      subtitle: `${a.typeLabel}${a.genre ? ` · ${a.genre}` : ''}${a.rating ? ` · ${a.rating}` : ''} · by ${a.name} · ${videoLine}`,
      description: a.logline || null,
      createdAt: a.createdAt,
      media: { src: a.media ? a.media.src : null, iframe: a.media ? a.media.iframe : null, poster: a.poster },
      meta: {
        rights: a.rightsResult === 'held' ? `needs paperwork: ${a.holds.join('; ')}` : a.rightsResult === 'clear' ? 'clear' : a.rightsResult || 'not checked',
        applicant: a.email,
        filesLink: a.mediaLink || null,
        masterReady: a.video ? a.video.state === 'ready' : false,
        goesLive: a.video ? 'Accept puts it live now, free with ads unless you pick Tapa +' : 'Accept grants Creator Studio; they upload there'
      },
      actions: ['approve', 'hold', 'reject']
    });
  }
  const subRows = subs.data || [];
  if (light) {
    for (const s of subRows) items.push({ kind: 'submission', id: s.id, createdAt: s.created_at });
  } else if (subRows.length > 0) {
    const ctx = await submissionContext(supabase, subRows);
    for (const s of subRows) {
      const item = submissionItem(s, ctx);
      item._season = s.season;
      item._number = s.series_order;
      items.push(item);
    }
  }
  for (const ad of ads || []) {
    items.push({
      kind: 'ad',
      id: ad.id,
      title: ad.title,
      subtitle: `${ad.accountCompanyName || 'Unknown advertiser'}${ad.budgetTotalCents != null ? ` · $${(ad.budgetTotalCents / 100).toFixed(2)} budget` : ''}`,
      description: ad.clickUrl ? `Clicks through to ${ad.clickUrl}` : null,
      createdAt: ad.createdAt || ad.created_at || null,
      media: { src: ad.videoUrl || null, poster: null },
      meta: { durationSeconds: ad.durationSeconds || null, clickUrl: ad.clickUrl || null, budgetTotalCents: ad.budgetTotalCents ?? null, placements: ad.placements || null, accountContactEmail: ad.accountContactEmail || null },
      actions: ['approve', 'reject']
    });
  }
  for (const m of channel || []) {
    items.push({
      kind: 'channel',
      id: m.id,
      title: m.title || 'Untitled upload',
      subtitle: `Channel upload · ${m.kindLabel || m.kind || 'video'}`,
      description: m.description || null,
      createdAt: m.createdAt || m.created_at || null,
      // Channel uploads need a signed preview URL; the client asks
      // /api/admin/channel-media?preview=<id> for it on demand.
      media: { src: null, poster: m.thumbnail || null, previewId: m.id },
      meta: { durationSeconds: m.durationSeconds || null },
      actions: ['approve', 'reject']
    });
  }
  // A place listed under Locations: approving it also marks the host
  // verified, so the proof (deed, lease, letter) is what to look at.
  for (const l of locations || []) {
    items.push({
      kind: 'location',
      id: l.id,
      title: l.title,
      subtitle: `${l.kindLabel} · ${l.place ? l.place.label : 'no place'} · ${l.rateLine} · by ${l.host ? l.host.displayName : l.hostId}`,
      description: l.description || null,
      createdAt: l.createdAt,
      media: { src: null, poster: l.coverUrl || null },
      meta: {
        address: l.address,
        hostSays: OWNERSHIP[l.ownership] || l.ownership,
        proofUrl: l.proofPreview || (l.proofUrl ? 'proof attached, could not be opened' : 'no proof attached'),
        proofNote: l.proofNote || null,
        photos: l.photos.length,
        listingUrl: `/locations/${l.id}`
      },
      actions: ['approve', 'reject']
    });
  }
  // Buy to own: a price (or a price change) a creator wants approved.
  // Approve = on sale at that price; reject = a note back to them, and a
  // title already on sale keeps its old price.
  for (const p of prices || []) {
    const d = (c) => `$${(c / 100).toFixed(2)}`;
    items.push({
      kind: 'price',
      id: p.id,
      title: `${p.title} · ${d(p.pendingCents)}`,
      subtitle: `${p.isChange ? `Price change from ${d(p.liveCents)}` : 'New price'} · ${p.type === 'series' ? 'whole series' : p.contentType || 'title'}${p.runtimeSeconds ? ` · ${Math.round(p.runtimeSeconds / 60)} min` : ''} · by ${p.creatorName}`,
      description: `Buyers keep it for good, ad-free. Creator gets 80% after the card fee (${d(Math.round((p.pendingCents - Math.round(p.pendingCents * 0.029 + 30)) * 0.8))} a sale).${p.peerRange ? ` Other ${p.type === 'series' ? 'series' : 'titles'} on sale here: ${d(p.peerRange.low)}–${d(p.peerRange.high)} (${p.peerRange.count}).` : ' Nothing else of this kind is on sale yet.'}`,
      createdAt: p.requestedAt,
      media: { src: null, poster: p.poster || null },
      meta: { asked: d(p.pendingCents), liveNow: p.liveCents ? d(p.liveCents) : 'not on sale yet', creatorPayouts: p.payoutReady ? 'ready' : 'NOT set up (sales can’t start until they are)', titleUrl: p.href },
      actions: ['approve', 'reject']
    });
  }
  const ordered = light ? items : queueOrder(items);
  return { items: ordered, counts: countBy(ordered) };
}

function emptyCounts() {
  return { total: 0, submission: 0, ad: 0, channel: 0, location: 0, price: 0, application: 0 };
}

function countBy(items) {
  const c = emptyCounts();
  for (const i of items) {
    if (Object.prototype.hasOwnProperty.call(c, i.kind)) c[i.kind] += 1;
    c.total += 1;
  }
  return c;
}

// { kind, id, decision: 'approve' | 'reject' | 'hold' (applications only), reason?, tierOverride? }
export async function decideReviewItem(rc, { kind, id, decision, reason, tierOverride }) {
  if (!canReview(rc)) throw Object.assign(new Error('You do not have permission to do this.'), { status: 403 });
  const decisions = kind === 'application' ? ['approve', 'reject', 'hold'] : ['approve', 'reject'];
  if (!DECIDABLE_KINDS.includes(kind) || !id || typeof id !== 'string' || !decisions.includes(decision)) {
    throw Object.assign(new Error('kind, id and a decision of approve/reject are required.'), { status: 400 });
  }
  const supabase = getSupabase();

  if (kind === 'application') {
    if (!canSeeApplications(rc)) throw Object.assign(new Error('You do not have permission to review applications.'), { status: 403 });
    if (decision === 'approve') {
      const result = await acceptApplication(rc, { id, tier: tierOverride, note: reason });
      return { ok: true, mode: result.mode, episode: result.episode, roleGranted: result.roleGranted };
    }
    if (decision === 'hold') {
      await holdApplication(rc, { id, note: reason });
      return { ok: true };
    }
    await declineApplication(rc, { id, note: reason });
    return { ok: true };
  }

  if (kind !== 'application' && !canSeeSubmissions(rc)) throw Object.assign(new Error('You do not have permission to do this.'), { status: 403 });

  if (kind === 'submission') {
    const { data: existing, error: readError } = await supabase.from('episodes').select('*').eq('id', id).maybeSingle();
    if (readError) throw Object.assign(new Error('Could not read the submission.'), { status: 500 });
    // A show's episode: one path with the admin show page (its number, its
    // slot and its master are checked there; one notice, one audit line).
    // A refusal is a ShowError: its line, status and extra fields (a taken
    // number's holder and the next free one, the master's state) reach the
    // route, which spreads them into its answer.
    if (existing && isShowEpisode(existing) && (existing.content_type === 'series' || existing.content_type === 'podcast')) {
      if (decision === 'approve') {
        const tier = tierOverride === 'free' || tierOverride === 'premium' ? tierOverride : 'keep';
        const out = await approveShowEpisodes(existing.series_id, { episodeIds: [id], tierOverride: tier }, rc);
        if (!out.approved.length) throw Object.assign(new Error('This submission was already reviewed. Reload the queue.'), { status: 409 });
        return { ok: true, showPublic: out.showPublic };
      }
      const out = await rejectShowEpisodes(existing.series_id, { episodeIds: [id], reason }, rc);
      if (!out.rejected.length) throw Object.assign(new Error('This submission was already reviewed. Reload the queue.'), { status: 409 });
      return { ok: true };
    }
    // A standalone title: its master has to be ready before it goes live.
    if (decision === 'approve' && existing) {
      const uid = cloudflareUidFromUrl(existing.src || '');
      const state = uid ? await videoStateFor(uid).catch(() => null) : null;
      const blocker = approvalBlocker({ ...existing, series_id: null }, { state: state || undefined });
      if (blocker) {
        const { status, error, ...extra } = blocker;
        throw new ShowError(error, status || 409, extra);
      }
    }
    const shown = existing ? episodeDisplayTitle(existing) : null;
    const updates = { status: decision === 'approve' ? 'approved' : 'rejected', reviewed_by: rc.userId, reviewed_at: new Date().toISOString() };
    // "Skip the artwork and we cut both from the film" (the creator path,
    // 2026-10-31): a standalone title approved without a poster or a still
    // gets them from Cloudflare's frame; an episode of a show with art of
    // its own keeps the show's.
    if (decision === 'approve' && existing && (!existing.poster || !existing.thumbnail) && !existing.series_id) {
      const art = await cutArtworkFromVideo(cloudflareUidFromUrl(existing.src), id, { poster: existing.poster, thumbnail: existing.thumbnail });
      if (art.poster && !existing.poster) updates.poster = art.poster;
      if (art.thumbnail && !existing.thumbnail) updates.thumbnail = art.thumbnail;
    }
    if (decision === 'reject') updates.rejection_reason = reason || null;
    if (decision === 'approve' && tierOverride && ['free', 'premium'].includes(tierOverride)) updates.tier = tierOverride;
    // Early screenings (migration 100): the 24-hour Premium window starts
    // now. Before the migration the column is missing; approve anyway.
    if (decision === 'approve') updates.released_at = updates.reviewed_at;
    let { data: changed, error } = await supabase.from('episodes').update(updates).eq('id', id).eq('status', 'pending').select('id');
    if (error && updates.released_at && /released_at/i.test(error.message || '')) {
      delete updates.released_at;
      ({ data: changed, error } = await supabase.from('episodes').update(updates).eq('id', id).eq('status', 'pending').select('id'));
    }
    if (error) throw new Error('Could not update the submission.');
    // Decided from a stale queue (someone else got there first): nothing
    // changed, so nobody is notified.
    if (!changed || changed.length === 0) throw Object.assign(new Error('This submission was already reviewed. Reload the queue.'), { status: 409 });
    await invalidateCache('public_episodes_v1');
    // A newly approved premium video must demand a signed URL from the
    // moment it's live (this used to wait for the manual sync) — and so do
    // its trailer and its show's (decision 12, see protectTrailers). The show
    // is read for its status too: one that isn't public yet keeps its
    // approved episodes off the site until its owner makes it public
    // (decision 2), and the notice below says so instead of "now live".
    let show = null;
    if (decision === 'approve' && existing) {
      if (existing.series_id) {
        const { data } = await supabase.from('series').select('trailer_src, status, name, creator_id').eq('id', existing.series_id).maybeSingle();
        show = data || null;
      }
      await Promise.all([
        syncStreamProtection({ src: existing.src, tier: updates.tier || existing.tier }),
        protectTrailers([existing.trailer_src, show ? show.trailer_src : null])
      ]);
    }
    await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: decision === 'approve' ? 'approve_submission' : 'reject_submission', targetType: 'episode', targetId: id, details: shown || undefined });
    if (existing) {
      const privateShow = Boolean(show && show.status && show.status !== 'approved');
      const theirs = privateShow && show.creator_id && show.creator_id === existing.submitted_by;
      await notifyCreator({
        userId: existing.submitted_by,
        type: decision === 'approve' ? 'episode_approved' : 'episode_rejected',
        message: decision !== 'approve'
          ? `"${shown}" was rejected.${reason ? ` Reason: ${reason}` : ''}`
          : privateShow
            ? `"${shown}" was approved. ${show.name || 'Its show'} stays private until ${theirs ? 'you make' : 'its owner makes'} it public.`
            : `"${shown}" was approved and is now live.`,
        episodeId: id,
        ...(privateShow ? { href: `/creator/show/${encodeURIComponent(existing.series_id)}#ep-${encodeURIComponent(id)}` } : {})
      });
    }
    return { ok: true };
  }

  if (kind === 'ad') {
    if (!rc.isAdmin) throw Object.assign(new Error('Only a full admin can review ads.'), { status: 403 });
    // Approving from the queue uses the site's default CPM; the web
    // review modal is where a per-ad rate gets set.
    const settings = await getSiteSettings();
    await reviewAdvertiserAd({
      adId: id,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      adminEmail: rc.email,
      costPerImpressionCents: decision === 'approve' && settings.adCpmCents ? settings.adCpmCents / 1000 : null,
      rejectionReason: reason
    });
    await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: `ad_${decision === 'approve' ? 'approved' : 'rejected'}`, targetType: 'house_ad', targetId: id });
    return { ok: true };
  }

  if (kind === 'location') {
    if (!rc.isAdmin) throw Object.assign(new Error('Only a full admin can review places.'), { status: 403 });
    return reviewListing(rc, { id, decision, reason });
  }

  if (kind === 'price') {
    if (!rc.isAdmin) throw Object.assign(new Error('Only a full admin can review prices.'), { status: 403 });
    const saved = await decidePrice({ priceId: id, decision, note: reason, reviewerId: rc.userId, reviewerEmail: rc.email });
    await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: `price_${decision}d`, targetType: saved.target_type, targetId: saved.target_id, details: decision === 'approve' ? `$${(saved.price_cents / 100).toFixed(2)}` : reason || null });
    return { ok: true };
  }

  // channel
  await reviewChannelMedia({ id, action: decision, reason, adminId: rc.userId });
  await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: `${decision}_channel_media`, targetType: 'channel_media', targetId: id, details: reason || null });
  return { ok: true };
}
