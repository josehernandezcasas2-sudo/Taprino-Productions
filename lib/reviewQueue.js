import { getSupabase } from './supabase';
import { syncStreamProtection } from './streamProtection';
import { hasCapability } from './capabilities';
import { getPendingAds, reviewAdvertiserAd } from './adAccounts';
import { listChannelMedia, reviewChannelMedia } from './channelMedia';
import { recordAudit } from './auditLog';
import { notifyCreator } from './notify';
import { invalidateCache } from './redis';
import { updateCompat } from './dbCompat';
import { getSiteSettings } from './siteSettings';
import { listPendingListings, reviewListing } from './locations';
import { OWNERSHIP } from './locationRules';
import { listPendingPrices, decidePrice } from './purchases';
import { listApplicationsForQueue, acceptApplication, holdApplication, declineApplication } from './creatorApplications';
import { cutArtworkFromVideo } from './artworkFromFilm';
import { cloudflareUidFromUrl } from './cloudflareUpload';
import { ShowError, makeShowPublic, protectTrailers } from './showPage';
import { canMakePublic, episodeDisplayTitle } from './showRules';

// One merged "needs your review" queue: creator submissions, advertiser
// ads, shows ready to go public, channel uploads, places, prices and
// applications. Feeds the admin dashboard
// (components/admin/ReviewQueue.js), /admin/review, and the mobile app's
// review-on-the-go screens, through /api/admin/review-queue.
//
// Every item is normalised to the same shape so one card component can
// render any of them:
//   { kind, id, title, subtitle, description, createdAt, media: { src,
//     poster }, meta: { ... kind-specific }, actions: ['approve','reject'] }
//
// Decisions reuse the same library calls the per-kind API routes make,
// so approving from here is identical to approving from the old hub.

export const QUEUE_KINDS = ['submission', 'ad', 'series', 'channel', 'location', 'price', 'application'];

// The 'series' kind is the queue's stand-in for Make it public (decision
// 2, Jose 2026-11-01) until the show pages bring the real button (the
// series revamp's slices 2 and 3). A show has no review of its own, so a
// private show is listed only once lib/showRules.js canMakePublic would let
// a full admin make it public: an approved episode, not pulled, no removal
// asked, not declined. One still waiting on its first approval isn't
// listed (its episodes are, as submissions), so nothing here can make an
// empty show public; after migration 118 every show without an approved
// episode is private, and each one lands here once an episode is approved.
// Two reads: the private shows, then their approved episodes with columns
// that exist before 118. Approved episodes are the only ones the rule
// counts, so asking for those alone gives the same answer, and a show with
// forty episodes in review doesn't fill the read. The episodes are asked
// for a hundred shows at a time: a show whose owner walks away before its
// first approval stays private for good, so the list only grows, and one
// `in` filter naming every one of them would outgrow the request line
// (the read would fail, and no show could be made public from here).
const SHOWS_PER_READ = 100;

async function listShowsReadyToGoPublic(supabase) {
  const { data: shows, error } = await supabase.from('series')
    .select('id, name, description, poster, thumbnail, status, creator_id, moderation_hold, deletion_requested, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('review queue shows:', error.message);
    return [];
  }
  if (!shows || shows.length === 0) return [];
  const ids = shows.map((s) => s.id);
  const reads = [];
  for (let i = 0; i < ids.length; i += SHOWS_PER_READ) {
    reads.push(supabase.from('episodes')
      .select('id, series_id, content_type, status, withdrawn_at, moderation_hold, deletion_requested')
      .in('series_id', ids.slice(i, i + SHOWS_PER_READ))
      .eq('status', 'approved'));
  }
  const results = await Promise.all(reads);
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error('review queue show episodes:', failed.error.message);
    return [];
  }
  const episodes = results.flatMap((r) => r.data || []);
  const bySeries = new Map();
  for (const e of episodes) {
    if (!bySeries.has(e.series_id)) bySeries.set(e.series_id, []);
    bySeries.get(e.series_id).push(e);
  }
  const ready = [];
  for (const show of shows) {
    const verdict = canMakePublic(show, bySeries.get(show.id) || [], { isAdmin: true });
    if (verdict.ok) ready.push({ show, approvedCount: verdict.releaseIds.length });
  }
  return ready;
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

export async function listReviewQueue(rc) {
  if (!canReview(rc)) return { items: [], counts: emptyCounts() };
  const supabase = getSupabase();
  const [subs, ads, series, channel, locations, prices, applications] = await Promise.all([
    canSeeSubmissions(rc) ? supabase.from('episodes').select('*').eq('status', 'pending').order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
    rc.isAdmin ? getPendingAds() : Promise.resolve([]),
    rc.isAdmin ? listShowsReadyToGoPublic(supabase) : Promise.resolve([]),
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
  for (const s of subs.data || []) {
    items.push({
      kind: 'submission',
      id: s.id,
      // A show's episode may be sent without a title (the show page's
      // drafts): it reads "Episode N" here as everywhere else.
      title: episodeDisplayTitle(s),
      subtitle: [s.content_type, s.genre, s.runtime].filter(Boolean).join(' · ') + (s.artist ? ` · by ${s.artist}` : ''),
      description: s.description || null,
      createdAt: s.created_at,
      media: { src: s.src || null, poster: s.poster || s.thumbnail || null },
      meta: { contentType: s.content_type, genre: s.genre, runtime: s.runtime, artist: s.artist, tier: s.tier, rating: s.rating || null, hasCaptions: Boolean(s.captions_url) },
      actions: ['approve', 'reject']
    });
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
  // A private show with an approved episode: approving it is Make it
  // public (see listShowsReadyToGoPublic).
  for (const { show: s, approvedCount } of series || []) {
    items.push({
      kind: 'series',
      id: s.id,
      title: s.name,
      subtitle: `Ready to go public · ${approvedCount} approved episode${approvedCount === 1 ? '' : 's'}`,
      description: s.description || null,
      createdAt: s.created_at,
      media: { src: null, poster: s.poster || s.thumbnail || null },
      meta: { readyToGoPublic: true, approvedCount },
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
  items.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
  return { items, counts: countBy(items) };
}

function emptyCounts() {
  return { total: 0, submission: 0, ad: 0, series: 0, channel: 0, location: 0, price: 0, application: 0 };
}

function countBy(items) {
  const c = emptyCounts();
  for (const i of items) { c[i.kind] += 1; c.total += 1; }
  return c;
}

// { kind, id, decision: 'approve' | 'reject' | 'hold' (applications only), reason?, tierOverride? }
export async function decideReviewItem(rc, { kind, id, decision, reason, tierOverride }) {
  if (!canReview(rc)) throw Object.assign(new Error('You do not have permission to do this.'), { status: 403 });
  const decisions = kind === 'application' ? ['approve', 'reject', 'hold'] : ['approve', 'reject'];
  if (!QUEUE_KINDS.includes(kind) || !id || !decisions.includes(decision)) {
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
    const { data: existing } = await supabase.from('episodes').select('title, submitted_by, src, trailer_src, tier, poster, thumbnail, series_id, series_order').eq('id', id).maybeSingle();
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

  if (kind === 'series') {
    if (!rc.isAdmin) throw Object.assign(new Error('Only a full admin can review series.'), { status: 403 });
    // Approve is Make it public (decision 2) until the show pages bring the
    // button: lib/showPage.js makeShowPublic asks canMakePublic again (from
    // a stale queue the show may have gone public, been pulled or lost its
    // episode), flips the show only while it is still private, restarts
    // the release clock on its approved episodes, protects the trailers,
    // invalidates the caches, audits 'show_live' and tells the owner. Its
    // refusals are written for the person and keep their status: 409 with
    // the rule's reason, 404 for a show that's gone.
    if (decision === 'approve') {
      try {
        const result = await makeShowPublic(id, { userId: rc.userId, email: rc.email, isAdmin: rc.isAdmin });
        return { ok: true, publicAt: result.publicAt, released: result.released };
      } catch (err) {
        if (err instanceof ShowError) throw Object.assign(new Error(err.message), { status: err.status });
        throw err;
      }
    }
    // Reject: only a series still waiting (rejecting from a stale queue
    // used to re-list one that had since been taken down), and the
    // reviewer's Clerk id rides along: a 118 column, which updateCompat
    // drops before 118 has run.
    const status = 'rejected';
    const now = new Date().toISOString();
    const patch = { status, reviewed_by: rc.email, reviewed_at: now, reviewed_by_user_id: rc.userId || null };
    const { data: changed, error } = await updateCompat(supabase, 'series', patch, ['reviewed_by_user_id'], (q) => q.eq('id', id).eq('status', 'pending').select('id'));
    if (error) throw new Error(error.message);
    if (!changed || changed.length === 0) throw Object.assign(new Error('This series was already reviewed. Reload the queue.'), { status: 409 });
    await invalidateCache('all_series_approved_v1');
    await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: `series_${status}`, targetType: 'series', targetId: id });
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
