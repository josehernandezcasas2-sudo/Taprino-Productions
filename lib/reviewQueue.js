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

// One merged "needs your review" queue: creator submissions, advertiser
// ads, new series, channel uploads. Feeds the admin dashboard
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

export const QUEUE_KINDS = ['submission', 'ad', 'series', 'channel', 'location', 'price'];

function canReview(rc) {
  return rc.isAdmin || hasCapability(rc, 'review_submissions');
}

export async function listReviewQueue(rc) {
  if (!canReview(rc)) return { items: [], counts: emptyCounts() };
  const supabase = getSupabase();
  const [subs, ads, series, channel, locations, prices] = await Promise.all([
    supabase.from('episodes').select('*').eq('status', 'pending').order('created_at', { ascending: true }),
    rc.isAdmin ? getPendingAds() : Promise.resolve([]),
    rc.isAdmin
      ? supabase.from('series').select('id, name, description, poster, thumbnail, submitted_by, created_at').eq('status', 'pending').order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    listChannelMedia({ all: true, status: 'pending' }).catch(() => []),
    rc.isAdmin ? listPendingListings().catch(() => []) : Promise.resolve([]),
    rc.isAdmin ? listPendingPrices().catch(() => []) : Promise.resolve([])
  ]);

  const items = [];
  for (const s of subs.data || []) {
    items.push({
      kind: 'submission',
      id: s.id,
      title: s.title,
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
  for (const s of series.data || []) {
    items.push({
      kind: 'series',
      id: s.id,
      title: s.name,
      subtitle: `New series · ${s.submitted_by || 'unknown submitter'}`,
      description: s.description || null,
      createdAt: s.created_at,
      media: { src: null, poster: s.poster || s.thumbnail || null },
      meta: {},
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
  return { total: 0, submission: 0, ad: 0, series: 0, channel: 0, location: 0, price: 0 };
}

function countBy(items) {
  const c = emptyCounts();
  for (const i of items) { c[i.kind] += 1; c.total += 1; }
  return c;
}

// { kind, id, decision: 'approve' | 'reject', reason?, tierOverride? }
export async function decideReviewItem(rc, { kind, id, decision, reason, tierOverride }) {
  if (!canReview(rc)) throw Object.assign(new Error('You do not have permission to do this.'), { status: 403 });
  if (!QUEUE_KINDS.includes(kind) || !id || !['approve', 'reject'].includes(decision)) {
    throw Object.assign(new Error('kind, id and a decision of approve/reject are required.'), { status: 400 });
  }
  const supabase = getSupabase();

  if (kind === 'submission') {
    const { data: existing } = await supabase.from('episodes').select('title, submitted_by, src, tier').eq('id', id).maybeSingle();
    const updates = { status: decision === 'approve' ? 'approved' : 'rejected', reviewed_by: rc.userId, reviewed_at: new Date().toISOString() };
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
    // moment it's live (this used to wait for the manual sync).
    if (decision === 'approve' && existing) await syncStreamProtection({ src: existing.src, tier: updates.tier || existing.tier });
    await recordAudit({ adminId: rc.userId, adminEmail: rc.email, action: decision === 'approve' ? 'approve_submission' : 'reject_submission', targetType: 'episode', targetId: id, details: existing ? existing.title : undefined });
    if (existing) {
      await notifyCreator({
        userId: existing.submitted_by,
        type: decision === 'approve' ? 'episode_approved' : 'episode_rejected',
        message: decision === 'approve' ? `"${existing.title}" was approved and is now live.` : `"${existing.title}" was rejected.${reason ? ` Reason: ${reason}` : ''}`,
        episodeId: id
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
    const status = decision === 'approve' ? 'approved' : 'rejected';
    // Only a series still waiting: approving from a stale queue used to
    // re-list one that had since been rejected or taken down.
    const { data: changed, error } = await supabase.from('series').update({ status, reviewed_by: rc.email, reviewed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('id');
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
