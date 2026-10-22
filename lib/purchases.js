import { getSupabase } from './supabase';
import { getStripe, isStripeConfigured } from './stripe';
import { getPayoutAccount, isPayoutReady } from './creatorPayouts';
import { getUserRole } from './roles';
import { getPublicIdentities } from './userProfiles';
import { notifyCreator } from './notify';
import { parseRuntimeToSeconds } from './videoMetadata';
import { SITE } from './siteConfig';
import {
  bundleCredit, cardFeeCents, currentPrice, DEFAULT_CUT_PERCENT, dollars, PRICE_MAX_CENTS, PRICE_MIN_CENTS, REFUND_DAYS, REFUND_WATCH_PERCENT,
  refundEligibility, splitPurchase, sumSales, validatePriceCents, validateSale
} from './purchaseRules';

// Sales tax (Jose, 2026-10-22: Stripe Tax on from the first sale). Checkout
// works it out from the buyer's address and the studio's registrations
// and adds it on top of the price; the webhook records it in
// purchases.tax_cents (migration 099). The product tax code is optional:
// blank means the Dashboard's default product tax code.
const TAX_CODE = (process.env.STRIPE_PURCHASE_TAX_CODE || '').trim();

// Buy to own, server side (migration 097; rules in lib/purchaseRules.js).
// A creator prices a film, an episode or a whole series; an admin
// approves the price from the review queue; a viewer buys it through
// Stripe Checkout as a destination charge to the creator's Express
// account (a studio-owned title keeps everything); the webhook completes
// the row and from then on the buyer is entitled to the title in every
// player, through any creator-side takedown. Refunds: self-serve within
// the window while under the watch limit, otherwise admin-only.

export class PurchaseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new PurchaseError(message, status); };

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}
function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}
const MIGRATION_MSG = 'Run migration 097 (Buy to own) in Supabase first.';
const TYPES = ['episode', 'series'];
const keyOf = (type, id) => `${type}:${id}`;

// --- settings --------------------------------------------------------------

export async function getPurchaseSettings() {
  const { data, error } = await getSupabase().from('site_settings').select('purchase_platform_cut_percent, purchase_min_cents, purchase_max_cents, purchase_refund_days, purchase_refund_watch_percent').eq('id', 1).maybeSingle();
  if (error || !data) {
    if (error && !isMissingColumn(error) && !isMissingTable(error)) console.error('getPurchaseSettings error:', error.message);
    return { cutPercent: DEFAULT_CUT_PERCENT, minCents: PRICE_MIN_CENTS, maxCents: PRICE_MAX_CENTS, refundDays: REFUND_DAYS, refundWatchPercent: REFUND_WATCH_PERCENT, migrated: false };
  }
  const n = (v, d) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    cutPercent: n(data.purchase_platform_cut_percent, DEFAULT_CUT_PERCENT),
    minCents: n(data.purchase_min_cents, PRICE_MIN_CENTS),
    maxCents: n(data.purchase_max_cents, PRICE_MAX_CENTS),
    refundDays: n(data.purchase_refund_days, REFUND_DAYS),
    refundWatchPercent: n(data.purchase_refund_watch_percent, REFUND_WATCH_PERCENT),
    migrated: true
  };
}

// --- the title behind a price ----------------------------------------------

// What a price or purchase points at, read without the public catalogue's
// filters so a withdrawn title still resolves for its owners. `hidden`
// is the legal switch (moderation hold, or never approved): nobody plays
// it; `withdrawn` is a creator-side takedown: owners still do.
export async function getTitleRecord(type, id) {
  if (!TYPES.includes(type) || !id) return null;
  const supabase = getSupabase();
  if (type === 'episode') {
    const { data } = await supabase.from('episodes').select('id, title, submitted_by, status, runtime, series_id, content_type, moderation_hold, deletion_requested, withdrawn_at, poster, thumbnail').eq('id', id).maybeSingle();
    if (!data) return null;
    let seriesHold = false;
    if (data.series_id) {
      const { data: parent } = await supabase.from('series').select('moderation_hold, status').eq('id', data.series_id).maybeSingle();
      seriesHold = Boolean(parent && (parent.moderation_hold || (parent.status && parent.status !== 'approved')));
    }
    return {
      type, id: data.id, title: data.title, creatorId: data.submitted_by, seriesId: data.series_id || null, contentType: data.content_type,
      runtimeSeconds: parseRuntimeToSeconds(data.runtime) || 0,
      hidden: Boolean(data.moderation_hold || seriesHold || data.status !== 'approved'),
      withdrawn: Boolean(data.deletion_requested || data.withdrawn_at),
      poster: data.poster || data.thumbnail || null
    };
  }
  const { data } = await supabase.from('series').select('id, name, creator_id, status, moderation_hold, deletion_requested, withdrawn_at, poster, thumbnail').eq('id', id).maybeSingle();
  if (!data) return null;
  return {
    type, id: data.id, title: data.name, creatorId: data.creator_id, seriesId: data.id, contentType: 'series', runtimeSeconds: 0,
    hidden: Boolean(data.moderation_hold || (data.status && data.status !== 'approved')),
    withdrawn: Boolean(data.deletion_requested || data.withdrawn_at),
    poster: data.poster || data.thumbnail || null
  };
}

// The episodes a series purchase covers: every approved one, including
// those withdrawn since (owners keep them); a hold still hides one.
export async function getSeriesEpisodeRecords(seriesId) {
  const { data, error } = await getSupabase().from('episodes').select('id, title, runtime, season, series_order, status, moderation_hold, deletion_requested, withdrawn_at, thumbnail').eq('series_id', seriesId).eq('status', 'approved');
  if (error) return [];
  return (data || []).filter((e) => !e.moderation_hold).map((e) => ({ id: e.id, title: e.title, runtimeSeconds: parseRuntimeToSeconds(e.runtime) || 0, season: e.season, seriesOrder: e.series_order, withdrawn: Boolean(e.deletion_requested || e.withdrawn_at), thumbnail: e.thumbnail || null }))
    .sort((a, b) => ((a.season || 1) - (b.season || 1)) || ((a.seriesOrder || 0) - (b.seriesOrder || 0)));
}

// A studio-owned title: its creator is a full admin, so there's nobody
// to transfer to and the studio keeps the whole price.
async function isHouseCreator(creatorId) {
  if (!creatorId) return true;
  try {
    return (await getUserRole(creatorId)) === 'admin';
  } catch (err) {
    return false;
  }
}

// --- prices ----------------------------------------------------------------

export async function getPriceRows(targets) {
  const list = (targets || []).filter((t) => t && TYPES.includes(t.type) && t.id);
  if (!list.length) return {};
  const supabase = getSupabase();
  const out = {};
  for (const type of TYPES) {
    const ids = [...new Set(list.filter((t) => t.type === type).map((t) => t.id))];
    if (!ids.length) continue;
    const { data, error } = await supabase.from('title_prices').select('*').eq('target_type', type).in('target_id', ids);
    if (error) {
      if (!isMissingTable(error)) console.error('getPriceRows error:', error.message);
      return out;
    }
    for (const row of data || []) out[keyOf(type, row.target_id)] = row;
  }
  return out;
}

export async function getPriceRow(type, id) {
  const rows = await getPriceRows([{ type, id }]);
  return rows[keyOf(type, id)] || null;
}

async function assertCanPrice(record, userId, isAdmin) {
  if (!record) fail('Title not found.', 404);
  if (!isAdmin && record.creatorId !== userId) fail('You can only price your own titles.', 403);
  if (record.hidden && record.type === 'episode') fail('This title isn’t published, so it can’t be sold yet.');
}

async function upsertPrice(type, id, patch) {
  const { data, error } = await getSupabase().from('title_prices').upsert({ target_type: type, target_id: id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'target_type,target_id' }).select('*').single();
  if (error) {
    if (isMissingTable(error)) fail(MIGRATION_MSG, 409);
    throw new Error(`title_prices write failed: ${error.message}`);
  }
  return data;
}

// The creator asks for a price (or a new one). The first price waits for
// review; a change keeps the old price live until the new one is
// approved. A full admin's own price is approved on the spot: they are
// the reviewer.
export async function requestPrice({ type, id, userId, isAdmin = false, cents }) {
  const record = await getTitleRecord(type, id);
  await assertCanPrice(record, userId, isAdmin);
  const settings = await getPurchaseSettings();
  const err = validatePriceCents(cents, { minCents: settings.minCents, maxCents: settings.maxCents });
  if (err) fail(err);
  const existing = await getPriceRow(type, id);
  const now = new Date().toISOString();
  if (existing && existing.price_cents === Number(cents) && existing.status === 'on' && !existing.pending_cents) return existing;
  if (isAdmin) {
    return upsertPrice(type, id, { creator_id: record.creatorId, price_cents: Number(cents), pending_cents: null, status: 'on', requested_at: now, reviewed_by: userId, reviewed_at: now, rejection_note: null });
  }
  return upsertPrice(type, id, {
    creator_id: record.creatorId,
    pending_cents: Number(cents),
    status: existing && existing.price_cents && existing.status === 'on' ? 'on' : 'pending',
    requested_at: now,
    rejection_note: null
  });
}

export async function stopSelling({ type, id, userId, isAdmin = false }) {
  const record = await getTitleRecord(type, id);
  await assertCanPrice(record, userId, isAdmin);
  const existing = await getPriceRow(type, id);
  if (!existing) fail('This title has no price.');
  return upsertPrice(type, id, { status: 'off', pending_cents: null, sale_percent: null, sale_ends_at: null, sale_members_only: false });
}

export async function startSelling({ type, id, userId, isAdmin = false }) {
  const record = await getTitleRecord(type, id);
  await assertCanPrice(record, userId, isAdmin);
  const existing = await getPriceRow(type, id);
  if (!existing || !existing.price_cents) fail('Set a price first; it goes on sale once it’s approved.');
  return upsertPrice(type, id, { status: 'on' });
}

// A sale needs no review: it can only lower an approved price.
export async function setSale({ type, id, userId, isAdmin = false, percent, endsAt, membersOnly = false }) {
  const record = await getTitleRecord(type, id);
  await assertCanPrice(record, userId, isAdmin);
  const existing = await getPriceRow(type, id);
  if (!existing || existing.status !== 'on' || !existing.price_cents) fail('A sale needs an approved price that’s on sale.');
  const err = validateSale({ percent, endsAt });
  if (err) fail(err);
  const end = new Date(endsAt);
  // A date typed as a day ends at the end of that day, UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(endsAt))) end.setUTCHours(23, 59, 59, 0);
  return upsertPrice(type, id, { sale_percent: Number(percent), sale_ends_at: end.toISOString(), sale_members_only: Boolean(membersOnly) });
}

export async function endSale({ type, id, userId, isAdmin = false }) {
  const record = await getTitleRecord(type, id);
  await assertCanPrice(record, userId, isAdmin);
  return upsertPrice(type, id, { sale_percent: null, sale_ends_at: null, sale_members_only: false });
}

// Every price row of a creator's, keyed like getPriceRows.
export async function getPricesForCreator(creatorId) {
  const { data, error } = await getSupabase().from('title_prices').select('*').eq('creator_id', creatorId);
  if (error) {
    if (!isMissingTable(error)) console.error('getPricesForCreator error:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((r) => [keyOf(r.target_type, r.target_id), r]));
}

// --- admin review ----------------------------------------------------------

// Prices waiting for a decision, with what the reviewer needs to judge
// them: the title, who's asking, what else like it sells for.
export async function listPendingPrices() {
  const { data, error } = await getSupabase().from('title_prices').select('*').not('pending_cents', 'is', null).order('requested_at', { ascending: true });
  if (error) {
    if (!isMissingTable(error)) console.error('listPendingPrices error:', error.message);
    return [];
  }
  const rows = data || [];
  if (!rows.length) return [];
  const [identities, live] = await Promise.all([
    getPublicIdentities([...new Set(rows.map((r) => r.creator_id))]),
    getSupabase().from('title_prices').select('target_type, price_cents').eq('status', 'on').not('price_cents', 'is', null)
  ]);
  const liveByType = {};
  for (const r of live.data || []) (liveByType[r.target_type] = liveByType[r.target_type] || []).push(Number(r.price_cents));
  const out = [];
  for (const row of rows) {
    const record = await getTitleRecord(row.target_type, row.target_id);
    if (!record) continue;
    const peers = (liveByType[row.target_type] || []).sort((a, b) => a - b);
    const account = await getPayoutAccount(row.creator_id).catch(() => null);
    out.push({
      id: row.id,
      type: row.target_type,
      targetId: row.target_id,
      title: record.title,
      contentType: record.contentType,
      runtimeSeconds: record.runtimeSeconds,
      poster: record.poster,
      creatorId: row.creator_id,
      creatorName: identities[row.creator_id] ? identities[row.creator_id].displayName : 'A creator',
      pendingCents: Number(row.pending_cents),
      liveCents: row.price_cents ? Number(row.price_cents) : null,
      isChange: Boolean(row.price_cents && row.status === 'on'),
      requestedAt: row.requested_at,
      peerRange: peers.length ? { low: peers[0], high: peers[peers.length - 1], count: peers.length } : null,
      payoutReady: isPayoutReady(account),
      href: row.target_type === 'episode' ? `/episode/${row.target_id}` : `/series/${row.target_id}`
    });
  }
  return out;
}

export async function decidePrice({ priceId, decision, note, reviewerId, reviewerEmail }) {
  if (!['approve', 'reject'].includes(decision)) fail('decision must be approve or reject.');
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('title_prices').select('*').eq('id', priceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.pending_cents == null) fail('Nothing is waiting for review on that title.', 404);
  const why = String(note || '').trim().slice(0, 300);
  if (decision === 'reject' && !why) fail('Tell the creator why (a short note).');
  const now = new Date().toISOString();
  const patch = decision === 'approve'
    ? { price_cents: row.pending_cents, pending_cents: null, status: 'on', reviewed_by: reviewerEmail || reviewerId, reviewed_at: now, rejection_note: null }
    : { pending_cents: null, status: row.price_cents && row.status === 'on' ? 'on' : 'rejected', reviewed_by: reviewerEmail || reviewerId, reviewed_at: now, rejection_note: why };
  const { data: saved, error: updateError } = await supabase.from('title_prices').update(patch).eq('id', priceId).select('*').single();
  if (updateError) throw new Error(updateError.message);
  const record = await getTitleRecord(row.target_type, row.target_id);
  const name = record ? record.title : 'your title';
  notifyCreator({
    userId: row.creator_id,
    type: 'purchase',
    message: decision === 'approve'
      ? `${name} is on sale at ${dollars(row.pending_cents)}. Buyers keep it for good; your share lands in your Stripe account with each sale.`
      : `We didn’t approve ${dollars(row.pending_cents)} for ${name}: ${why}${row.price_cents && row.status === 'on' ? ` It stays on sale at ${dollars(row.price_cents)}.` : ''}`,
    href: '/creator/my-work'
  }).catch(() => {});
  return saved;
}

// --- ownership -------------------------------------------------------------

// Everything a viewer owns: episode ids bought outright, series ids
// bought as a bundle (every episode of those is theirs), and the rows.
export async function getOwnership(userId) {
  const empty = { episodeIds: new Set(), seriesIds: new Set(), byEpisode: {}, bySeries: {}, purchases: [] };
  if (!userId) return empty;
  const { data, error } = await getSupabase().from('purchases').select('*').eq('buyer_id', userId).eq('status', 'completed');
  if (error) {
    if (!isMissingTable(error)) console.error('getOwnership error:', error.message);
    return empty;
  }
  const out = { ...empty, purchases: data || [] };
  for (const p of out.purchases) {
    if (p.target_type === 'episode') { out.episodeIds.add(p.target_id); out.byEpisode[p.target_id] = p; } else { out.seriesIds.add(p.target_id); out.bySeries[p.target_id] = p; }
  }
  return out;
}

export function ownsEpisode(ownership, episode) {
  if (!ownership || !episode) return false;
  return ownership.episodeIds.has(episode.id) || Boolean(episode.seriesId && ownership.seriesIds.has(episode.seriesId));
}

export async function userOwnsEpisode(userId, episode) {
  if (!userId || !episode) return false;
  return ownsEpisode(await getOwnership(userId), episode);
}

// What this viewer would pay for a title now, and whether they own it.
export async function getOffer({ type, id, userId = null, isMember = false, ownership = null, priceRow = undefined }) {
  const row = priceRow === undefined ? await getPriceRow(type, id) : priceRow;
  const own = ownership || await getOwnership(userId);
  const price = currentPrice(row, { isMember });
  const base = { type, id, ...price, creditCents: 0, payCents: price.cents, owned: false, purchaseId: null, boughtAt: null, ownedEpisodeIds: [] };
  if (type === 'episode') {
    const record = own.byEpisode[id];
    const viaSeries = !record && [...own.seriesIds].length ? await (async () => {
      const r = await getTitleRecord('episode', id);
      return r && r.seriesId && own.seriesIds.has(r.seriesId) ? own.bySeries[r.seriesId] : null;
    })() : null;
    const p = record || viaSeries;
    return { ...base, owned: Boolean(p), purchaseId: p ? p.id : null, boughtAt: p ? p.completed_at : null, viaSeries: Boolean(viaSeries) };
  }
  const bundle = own.bySeries[id];
  if (bundle) return { ...base, owned: true, purchaseId: bundle.id, boughtAt: bundle.completed_at };
  // Episodes of the series already bought one by one come off the bundle.
  const episodes = price.forSale ? await getSeriesEpisodeRecords(id) : [];
  const ownedEps = episodes.filter((e) => own.episodeIds.has(e.id));
  const credit = price.forSale ? bundleCredit(price.cents, ownedEps.map((e) => Number(own.byEpisode[e.id].paid_cents) || 0)) : { creditCents: 0, payCents: price.cents };
  return { ...base, creditCents: credit.creditCents, payCents: credit.payCents, ownedEpisodeIds: ownedEps.map((e) => e.id), episodeCount: episodes.length };
}

// Offers for a list of titles at once (a series page's episode rows, a
// library row): keyed like getPriceRows. Owned titles show owned: true.
export async function getOffers(targets, { userId = null, isMember = false } = {}) {
  const rows = await getPriceRows(targets);
  const own = await getOwnership(userId);
  const out = {};
  for (const t of targets || []) {
    const k = keyOf(t.type, t.id);
    out[k] = await getOffer({ type: t.type, id: t.id, userId, isMember, ownership: own, priceRow: rows[k] || null });
  }
  return out;
}

// --- buying ----------------------------------------------------------------

export async function createPurchaseCheckout({ type, id, buyerId, buyerEmail, isMember = false, origin, returnTo }) {
  if (!TYPES.includes(type) || !id) fail('Say what to buy.');
  if (!buyerId) fail('Sign in to buy.', 401);
  if (!isStripeConfigured()) fail('Payments aren’t set up on this site yet.', 503);
  const record = await getTitleRecord(type, id);
  if (!record || record.hidden) fail('Title not found.', 404);
  if (record.withdrawn) fail('This title is no longer for sale.');
  if (record.creatorId === buyerId) fail('That’s your own title.');
  const offer = await getOffer({ type, id, userId: buyerId, isMember });
  if (offer.owned) fail('You already own this.');
  if (!offer.forSale) fail('This title isn’t for sale.');

  const settings = await getPurchaseSettings();
  const house = await isHouseCreator(record.creatorId);
  let account = null;
  if (!house) {
    account = await getPayoutAccount(record.creatorId);
    if (!isPayoutReady(account)) fail('This title can’t be sold yet: the creator hasn’t finished payout setup.');
  }
  const split = splitPurchase(offer.payCents, settings.cutPercent, { house });
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('purchases').insert({
    buyer_id: buyerId,
    buyer_email: buyerEmail || null,
    target_type: type,
    target_id: id,
    creator_id: record.creatorId,
    title: record.title,
    price_cents: offer.listCents,
    paid_cents: split.paidCents,
    sale_percent: offer.onSale ? offer.salePercent : null,
    credit_cents: offer.creditCents,
    fee_cents: split.feeCents,
    creator_cents: split.creatorCents,
    platform_cents: split.platformCents,
    house,
    status: 'pending'
  }).select('*').single();
  if (error) {
    if (isMissingTable(error)) fail(MIGRATION_MSG, 409);
    throw new Error(error.message);
  }

  const back = typeof returnTo === 'string' && /^\/[A-Za-z0-9_\-/.?=&%]*$/.test(returnTo) ? returnTo : (type === 'episode' ? `/episode/${id}` : `/series/${id}`);
  const joiner = back.includes('?') ? '&' : '?';
  const metadata = { type: 'title_purchase', purchase_id: row.id, target_type: type, target_id: id, buyer_id: buyerId };
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: split.paidCents,
          // The price is the price; tax goes on top (Terms section 15).
          // Pinned here so the Dashboard's "include tax in prices" default
          // can't carve the tax out of the creator's share instead.
          tax_behavior: 'exclusive',
          product_data: {
            name: `Own “${record.title}”`,
            description: `${type === 'series' ? 'Every episode, now and later' : 'Yours for good'} · ad-free on ${SITE.name}${offer.onSale ? ` · ${offer.salePercent}% off` : ''}${offer.creditCents ? ` · ${dollars(offer.creditCents)} off for episodes you own` : ''}`,
            ...(TAX_CODE ? { tax_code: TAX_CODE } : {})
          }
        }
      }],
      // Stripe Tax adds the sales tax on top of the price. The creator's
      // share is fixed by transfer_data.amount (not an application fee),
      // so the tax, and Stripe's fee on the whole charge, stay on the
      // studio's side whatever the buyer's rate turns out to be.
      automatic_tax: { enabled: true },
      payment_intent_data: {
        ...(house ? {} : { transfer_data: { destination: account.stripeAccountId, amount: split.creatorCents } }),
        description: `Own “${record.title}” on ${SITE.name}`,
        metadata
      },
      metadata,
      success_url: `${origin}${back}${joiner}bought=${row.id}`,
      cancel_url: `${origin}${back}${joiner}bought=cancelled`
    });
  } catch (err) {
    await supabase.from('purchases').update({ status: 'failed', failed_reason: `checkout not created: ${err.message}`.slice(0, 300) }).eq('id', row.id);
    throw new Error(`Stripe couldn’t start the payment: ${err.message}`);
  }
  await supabase.from('purchases').update({ stripe_checkout_session_id: session.id }).eq('id', row.id);
  return { url: session.url, purchaseId: row.id, payCents: split.paidCents };
}

const piOf = (session) => (typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null);

// Webhook: paid. Idempotent on the session (and the row id in metadata).
export async function completePurchaseFromSession(session) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  let row = null;
  const bySession = await supabase.from('purchases').select('*').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (bySession.error && isMissingTable(bySession.error)) return { skipped: 'migration 097 not run' };
  row = bySession.data;
  if (!row && meta.purchase_id) row = (await supabase.from('purchases').select('*').eq('id', meta.purchase_id).maybeSingle()).data;
  if (!row) throw new Error(`Completed purchase session ${session.id} has no row.`);
  if (row.status === 'completed') return { duplicate: true, id: row.id };
  // What Stripe Tax added, and Stripe's fee on the whole charge (price +
  // tax), so Studio money's expected net per sale (platform − fee + tax)
  // matches the balance. The creator's share was fixed at Checkout.
  const taxCents = Math.max(0, Number(session.total_details && session.total_details.amount_tax) || 0);
  const totalCents = Math.max(0, Number(session.amount_total) || 0) || Number(row.paid_cents) + taxCents;
  const patch = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    stripe_payment_intent_id: piOf(session),
    stripe_checkout_session_id: session.id,
    buyer_email: session.customer_details && session.customer_details.email ? session.customer_details.email : undefined,
    tax_cents: taxCents,
    fee_cents: cardFeeCents(totalCents)
  };
  if (patch.buyer_email === undefined) delete patch.buyer_email;
  let { error } = await supabase.from('purchases').update(patch).eq('id', row.id);
  if (error && isMissingColumn(error)) {
    // Before migration 099: complete the sale without the tax column.
    delete patch.tax_cents;
    ({ error } = await supabase.from('purchases').update(patch).eq('id', row.id));
  }
  if (error) throw new Error(error.message);
  if (!row.house) {
    notifyCreator({
      userId: row.creator_id,
      type: 'purchase',
      message: `Someone bought ${row.title || 'your title'} for ${dollars(row.paid_cents)}. ${dollars(row.creator_cents)} is in your Stripe account.`,
      href: '/account'
    }).catch(() => {});
  }
  return { id: row.id };
}

export async function failPurchaseFromSession(session, reason = 'checkout expired') {
  const { error } = await getSupabase().from('purchases').update({ status: 'failed', failed_reason: reason }).eq('stripe_checkout_session_id', session.id).eq('status', 'pending');
  if (error && !isMissingTable(error)) throw new Error(error.message);
}

// --- watching --------------------------------------------------------------

// The furthest point a buyer reached in an episode they own (by itself or
// as part of a series), for the refund rule. Only ever moves forward.
export async function recordWatchedMax(userId, episodeId, seconds) {
  const secs = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!userId || !episodeId || !(secs > 0)) return;
  const own = await getOwnership(userId);
  if (!own.purchases.length) return;
  const direct = own.byEpisode[episodeId];
  let viaSeries = null;
  if (!direct && own.seriesIds.size) {
    const { data } = await getSupabase().from('episodes').select('series_id').eq('id', episodeId).maybeSingle();
    if (data && data.series_id && own.seriesIds.has(data.series_id)) viaSeries = own.bySeries[data.series_id];
  }
  const p = direct || viaSeries;
  if (!p) return;
  const current = (p.watched_max && typeof p.watched_max === 'object') ? p.watched_max : {};
  if (Number(current[episodeId]) >= secs) return;
  const { error } = await getSupabase().from('purchases').update({ watched_max: { ...current, [episodeId]: secs } }).eq('id', p.id);
  if (error) console.error('recordWatchedMax error:', error.message);
}

async function runtimesFor(purchase) {
  if (purchase.target_type === 'episode') {
    const r = await getTitleRecord('episode', purchase.target_id);
    return { [purchase.target_id]: r ? r.runtimeSeconds : 0 };
  }
  const eps = await getSeriesEpisodeRecords(purchase.target_id);
  return Object.fromEntries(eps.map((e) => [e.id, e.runtimeSeconds]));
}

// --- refunds ---------------------------------------------------------------

// kind: self (the buyer, within the rules), admin (final), takedown (a
// legal takedown: every buyer), stripe (mirrored from the dashboard).
export async function refundPurchase({ purchaseId, kind, actorId = null, actorEmail = null, reason = '' }) {
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('purchases').select('*').eq('id', purchaseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) fail('Purchase not found.', 404);
  if (row.status === 'refunded') return { alreadyRefunded: true, purchase: row };
  if (row.status !== 'completed') fail(`Only a completed purchase can be refunded (this one is ${row.status}).`);
  if (kind === 'self') {
    if (row.buyer_id !== actorId) fail('That isn’t your purchase.', 403);
    const settings = await getPurchaseSettings();
    const check = refundEligibility(row, { runtimes: await runtimesFor(row), days: settings.refundDays, watchPercent: settings.refundWatchPercent });
    if (!check.ok) fail(`This purchase can’t be refunded from here: ${check.reason}. Email ${SITE.contactEmail} if something went wrong.`);
  }
  if (!row.stripe_payment_intent_id) fail('This purchase has no Stripe payment attached, so Stripe can’t refund it.');
  const stripe = getStripe();
  // The buyer gets everything back (price and tax) from the studio's
  // balance; reverse_transfer pulls the creator's share back. There is no
  // application fee to refund: the studio's take was simply what stayed
  // behind after transfer_data.amount (older rows made with an
  // application fee come out the same, the studio absorbs Stripe's fee).
  const refund = await stripe.refunds.create(
    {
      payment_intent: row.stripe_payment_intent_id,
      ...(row.house ? {} : { reverse_transfer: true }),
      metadata: { type: 'title_purchase', purchase_id: row.id, kind }
    },
    { idempotencyKey: `title-purchase-refund-${row.id}` }
  );
  const patch = { status: 'refunded', refunded_at: new Date().toISOString(), refunded_by: actorEmail || actorId || kind, refund_reason: String(reason || '').trim().slice(0, 300) || null, refund_kind: kind };
  const { data: updated, error: updateError } = await supabase.from('purchases').update(patch).eq('id', row.id).select('*').single();
  if (updateError) throw new Error(`Stripe refunded it (${refund.id}) but the record didn’t update: ${updateError.message}`);
  if (kind !== 'self' && !row.house) {
    notifyCreator({ userId: row.creator_id, type: 'purchase', message: `A purchase of ${row.title || 'your title'} (${dollars(row.paid_cents)}) was refunded${reason ? `: ${String(reason).slice(0, 120)}` : ''}. ${dollars(row.creator_cents)} came back out of your balance.`, href: '/account' }).catch(() => {});
  }
  return { refundId: refund.id, purchase: updated };
}

// A full refund made in the Stripe dashboard.
export async function refundPurchaseFromCharge(charge) {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent && charge.payment_intent.id) || null;
  if (!pi || !charge.refunded) return { ignored: true };
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('purchases').select('id, status').eq('stripe_payment_intent_id', pi).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ignored: true };
    throw new Error(error.message);
  }
  if (!row) return { ignored: true };
  if (row.status === 'refunded') return { duplicate: true, id: row.id };
  const { error: updateError } = await supabase.from('purchases').update({ status: 'refunded', refunded_at: new Date().toISOString(), refunded_by: 'stripe', refund_reason: 'refunded in Stripe', refund_kind: 'stripe' }).eq('id', row.id);
  if (updateError) throw new Error(updateError.message);
  return { id: row.id };
}

// A legal takedown: nobody can keep it, so every buyer is refunded.
export async function refundAllForTitle({ type, id, actorId, actorEmail, reason }) {
  const { data, error } = await getSupabase().from('purchases').select('id').eq('target_type', type).eq('target_id', id).eq('status', 'completed');
  if (error) {
    if (isMissingTable(error)) return { refunded: 0, failed: [] };
    throw new Error(error.message);
  }
  const failed = [];
  let refunded = 0;
  for (const p of data || []) {
    try {
      await refundPurchase({ purchaseId: p.id, kind: 'takedown', actorId, actorEmail, reason: reason || 'taken down for a legal reason' });
      refunded += 1;
    } catch (err) {
      failed.push({ id: p.id, error: err.message });
    }
  }
  return { refunded, failed };
}

// --- after a takedown --------------------------------------------------------

export async function countBuyers(type, id) {
  const { count, error } = await getSupabase().from('purchases').select('id', { count: 'exact', head: true }).eq('target_type', type).eq('target_id', id).eq('status', 'completed');
  if (error) return 0;
  return count || 0;
}

// Buyers of a series own its episodes too, so an episode of a bought
// series can't be deleted either.
export async function hasBuyersIncludingSeries(type, id) {
  if ((await countBuyers(type, id)) > 0) return true;
  if (type === 'episode') {
    const { data } = await getSupabase().from('episodes').select('series_id').eq('id', id).maybeSingle();
    if (data && data.series_id && (await countBuyers('series', data.series_id)) > 0) return true;
  }
  return false;
}

// --- the buyer's library ---------------------------------------------------

export async function getLibrary(userId) {
  const own = await getOwnership(userId);
  if (!own.purchases.length) return { items: [], available: true };
  const settings = await getPurchaseSettings();
  const items = [];
  for (const p of [...own.purchases].sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))) {
    const record = await getTitleRecord(p.target_type, p.target_id);
    const runtimes = await runtimesFor(p);
    const check = refundEligibility(p, { runtimes, days: settings.refundDays, watchPercent: settings.refundWatchPercent });
    const episodes = p.target_type === 'series' ? await getSeriesEpisodeRecords(p.target_id) : [];
    items.push({
      id: p.id,
      type: p.target_type,
      targetId: p.target_id,
      title: record ? record.title : p.title,
      poster: record ? record.poster : null,
      contentType: record ? record.contentType : p.target_type,
      runtimeSeconds: record ? record.runtimeSeconds : 0,
      episodeCount: episodes.length,
      creatorId: p.creator_id,
      paidCents: Number(p.paid_cents),
      taxCents: Number(p.tax_cents) || 0,
      boughtAt: p.completed_at,
      hidden: Boolean(record && record.hidden),
      withdrawn: Boolean(record && record.withdrawn),
      watchedPercent: Math.round(check.watchedPercent),
      refund: { ok: check.ok, reason: check.reason, until: check.until },
      href: p.target_type === 'episode' ? `/episode/${p.target_id}?autoplay=1` : `/series/${p.target_id}`
    });
  }
  const ids = [...new Set(items.map((i) => i.creatorId))];
  const identities = await getPublicIdentities(ids);
  for (const i of items) i.creatorName = identities[i.creatorId] ? identities[i.creatorId].displayName : null;
  return { items, available: true, refundDays: settings.refundDays, refundWatchPercent: settings.refundWatchPercent };
}

// --- the creator's Sales card ----------------------------------------------

export async function getSalesForCreator(creatorId) {
  const supabase = getSupabase();
  const [all, prices] = await Promise.all([
    supabase.from('purchases').select('*').eq('creator_id', creatorId).in('status', ['completed', 'refunded']).order('completed_at', { ascending: false }).limit(2000),
    getPricesForCreator(creatorId)
  ]);
  if (all.error) {
    if (isMissingTable(all.error)) return { available: false };
    throw new Error(all.error.message);
  }
  const rows = all.data || [];
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const thisMonth = rows.filter((r) => (r.completed_at || '') >= monthStart);
  const byKey = {};
  for (const r of rows) {
    const k = keyOf(r.target_type, r.target_id);
    byKey[k] = byKey[k] || { key: k, type: r.target_type, targetId: r.target_id, title: r.title, rows: [] };
    byKey[k].rows.push(r);
  }
  for (const [k, row] of Object.entries(prices)) {
    byKey[k] = byKey[k] || { key: k, type: row.target_type, targetId: row.target_id, title: null, rows: [] };
    byKey[k].price = row;
  }
  const titles = [];
  for (const t of Object.values(byKey)) {
    if (!t.title) {
      const record = await getTitleRecord(t.type, t.targetId);
      t.title = record ? record.title : 'A title';
    }
    const s = sumSales(t.rows);
    const price = t.price || null;
    titles.push({
      type: t.type, targetId: t.targetId, title: t.title, sold: s.count, creatorCents: s.creatorCents, refunds: s.refunds,
      priceState: price ? price.status : 'none', priceCents: price && price.price_cents ? Number(price.price_cents) : null, pendingCents: price && price.pending_cents ? Number(price.pending_cents) : null,
      sale: price && price.sale_percent && price.sale_ends_at && new Date(price.sale_ends_at) > new Date() ? { percent: Number(price.sale_percent), endsAt: price.sale_ends_at, membersOnly: Boolean(price.sale_members_only) } : null
    });
  }
  titles.sort((a, b) => b.creatorCents - a.creatorCents);
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString();
  const refundedYear = rows.filter((r) => r.status === 'refunded' && (r.refunded_at || '') >= yearStart);
  return {
    available: true,
    month: sumSales(thisMonth),
    allTime: sumSales(rows),
    refundsThisYear: { count: refundedYear.length, creatorCents: refundedYear.reduce((s, r) => s + (Number(r.creator_cents) || 0), 0) },
    titles
  };
}

// The studio's view: recent purchases with names, for /admin/purchases.
export async function listRecentPurchases({ limit = 50 } = {}) {
  const { data, error } = await getSupabase().from('purchases').select('*').in('status', ['completed', 'refunded']).order('completed_at', { ascending: false }).limit(limit);
  if (error) {
    if (isMissingTable(error)) return { available: false, purchases: [] };
    throw new Error(error.message);
  }
  const rows = data || [];
  const identities = await getPublicIdentities([...new Set(rows.flatMap((r) => [r.buyer_id, r.creator_id]))]);
  const name = (id) => (identities[id] ? identities[id].displayName : id);
  return {
    available: true,
    purchases: rows.map((r) => ({
      id: r.id, type: r.target_type, targetId: r.target_id, title: r.title, buyerId: r.buyer_id, buyerName: name(r.buyer_id), creatorId: r.creator_id, creatorName: name(r.creator_id),
      paidCents: Number(r.paid_cents), taxCents: Number(r.tax_cents) || 0, creatorCents: Number(r.creator_cents), platformCents: Number(r.platform_cents), feeCents: Number(r.fee_cents), house: Boolean(r.house),
      status: r.status, completedAt: r.completed_at, refundedAt: r.refunded_at, refundKind: r.refund_kind, refundReason: r.refund_reason,
      watchedMax: r.watched_max || {}, href: r.target_type === 'episode' ? `/episode/${r.target_id}` : `/series/${r.target_id}`
    }))
  };
}
