import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { getPayoutAccount, isPayoutReady } from './creatorPayouts';
import { getUserRole } from './roles';
import { dollars } from './donationMath';
import { notifyCreator, sendEmail } from './notify';
import { getPublicIdentities } from './userProfiles';
import { getUserEmail, getBlocksBetween } from './messages';
import { getSuspensionFor } from './suspensions';
import { SITE } from './siteConfig';
import { TIP_PRESETS_CENTS, MIN_TIP_CENTS, DEFAULT_TIP_MAX_CENTS, DEFAULT_TIP_CUT_PERCENT, DEFAULT_TIP_CUT_MAX_CENTS, tipQuote, validateTipInput, tipEmailDue, tipperLabel, safeTipReturn } from './tipRules';

// SERVER-ONLY. Tips: the fan support lane (migration 088 table, 101 the
// dispute columns and the fiscal-sponsor link; canvas signed off
// 2026-10-24). A tip is a destination charge to the creator's Express
// account, the exact shape Pitch Room backing uses: the fan covers the
// card fee on top of the tip so the creator keeps more, the studio's
// cut is the application fee. Only `completed` counts; refunds are
// admin-only and final (Stripe keeps its fee, the studio absorbs it);
// chargebacks follow backing (lib/paymentDisputes.js). Notes are
// private between fan and creator; the creator can hide one, anyone can
// report one (lib/moderation.js target `tip`).

const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));
const isMissingColumn = (error) => Boolean(error && /column|PGRST204/i.test(error.message || ''));
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || SITE.productionDomain || 'https://www.studiotapatv.site').replace(/\/$/, '');
const piOf = (v) => (typeof v === 'string' ? v : (v && v.id) || null);

export function rowToTip(row) {
  return {
    id: row.id,
    creatorId: row.creator_id,
    tipperId: row.tipper_id,
    amountCents: Number(row.amount_cents) || 0,
    cutPercent: Number(row.platform_cut_percent) || 0,
    cutCents: Number(row.platform_cut_cents) || 0,
    creatorCents: Number(row.creator_payout_cents) || 0,
    feeCents: Number(row.fee_cover_cents) || 0,
    totalCents: Number(row.total_charged_cents) || 0,
    note: row.note || null,
    noteHidden: Boolean(row.note_hidden),
    showName: Boolean(row.show_name),
    status: row.status,
    completedAt: row.completed_at || null,
    refundedAt: row.refunded_at || null,
    refundReason: row.refund_reason || null,
    createdAt: row.created_at,
    dispute: row.dispute_status ? { status: row.dispute_status, clawbackCents: Number(row.clawback_cents) || 0, returnedCents: Number(row.returned_cents) || 0 } : null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null
  };
}

// site_settings.tip_platform_cut_percent / tip_max_cents (migration 088)
// and tip_cut_max_cents (101: the most the studio keeps from one tip),
// with the defaults when the row or columns are missing. Edited on
// /admin/settings.
export async function getTipSettings() {
  const { data, error } = await getSupabase().from('site_settings').select('tip_platform_cut_percent, tip_max_cents, tip_cut_max_cents').eq('id', 1).maybeSingle();
  if (error && !isMissingTable(error) && !isMissingColumn(error)) console.error('getTipSettings error:', error.message);
  const cut = data && data.tip_platform_cut_percent != null ? Number(data.tip_platform_cut_percent) : DEFAULT_TIP_CUT_PERCENT;
  const max = data && Number(data.tip_max_cents) >= MIN_TIP_CENTS ? Number(data.tip_max_cents) : DEFAULT_TIP_MAX_CENTS;
  const cutMax = data && data.tip_cut_max_cents != null && Number(data.tip_cut_max_cents) >= 0 ? Math.round(Number(data.tip_cut_max_cents)) : DEFAULT_TIP_CUT_MAX_CENTS;
  return { cutPercent: Number.isFinite(cut) && cut >= 0 && cut < 100 ? cut : DEFAULT_TIP_CUT_PERCENT, maxCents: max, cutMaxCents: cutMax };
}

async function fiscalSponsorFor(userId) {
  const { data, error } = await getSupabase().from('user_profiles').select('fiscal_sponsor_name, fiscal_sponsor_url').eq('user_id', userId).maybeSingle();
  if (error || !data || !data.fiscal_sponsor_url) return null;
  return { name: data.fiscal_sponsor_name || 'their fiscal sponsor', url: data.fiscal_sponsor_url };
}

// What a page needs to show (or hide) the Tip button for `creatorId`.
// Jose (2026-10-24): the button only exists once the creator's Stripe
// account can take charges; before that nothing shows. `isCreator` can
// be passed when the caller already knows the role (profile hub) to
// save the Clerk read.
// Why tipping is off is told only where it's about the viewer (their own
// profile, a suspension, a block): whether someone else has finished
// payout setup, or holds the creator role, isn't anyone's business
// (security round, 2026-10-26). `internal` keeps the detail for the
// checkout's own error message.
export async function getTipping(creatorId, { viewerId = null, isCreator = null, internal = false } = {}) {
  const t = await tippingFor(creatorId, { viewerId, isCreator });
  if (internal || t.enabled || !['payouts not ready', 'not a creator'].includes(t.reason)) return t;
  return { ...t, reason: null };
}

async function tippingFor(creatorId, { viewerId = null, isCreator = null } = {}) {
  const off = { enabled: false, creatorId, reason: null };
  if (!creatorId) return off;
  if (viewerId && viewerId === creatorId) return { ...off, reason: 'self' };
  // The payout account first (one database read): most people have none,
  // and only then is Clerk asked about the role.
  const account = await getPayoutAccount(creatorId);
  if (!isPayoutReady(account)) return { ...off, reason: 'payouts not ready' };
  // The viewer's side (migration 102, Jose 2026-10-24): a tips-only or
  // whole-account suspension switches the button off everywhere for
  // them, and a creator who blocked them in Messages (either direction)
  // can't be tipped by them. Both read as "no button", like before.
  if (viewerId) {
    const [suspended, blocks] = await Promise.all([
      getSuspensionFor(viewerId),
      getBlocksBetween(viewerId, creatorId).catch(() => ({ iBlocked: false, blockedMe: false }))
    ]);
    if (suspended && (suspended.scope === 'all' || suspended.scope === 'tips')) return { ...off, reason: 'suspended' };
    if (blocks.iBlocked || blocks.blockedMe) return { ...off, reason: 'blocked' };
  }
  let creator = isCreator;
  if (creator == null) {
    const role = await getUserRole(creatorId);
    creator = role === 'creator' || role === 'admin';
  }
  if (!creator) return { ...off, reason: 'not a creator' };
  const [settings, identities, fiscalSponsor] = await Promise.all([getTipSettings(), getPublicIdentities([creatorId]).catch(() => ({})), fiscalSponsorFor(creatorId)]);
  const who = identities[creatorId];
  return {
    enabled: true,
    creatorId,
    creatorName: who ? who.displayName : 'this creator',
    // The sheet's header photo, honouring the profile's focal point + zoom.
    creatorAvatar: who && who.avatarUrl ? { url: who.avatarUrl, position: who.avatarPosition || null, zoom: who.avatarZoom || 1 } : null,
    cutPercent: settings.cutPercent,
    cutMaxCents: settings.cutMaxCents,
    maxCents: settings.maxCents,
    minCents: MIN_TIP_CENTS,
    presets: TIP_PRESETS_CENTS,
    fiscalSponsor
  };
}

// Starts a tip: a pending row plus a Stripe Checkout session. `returnTo`
// is the page the fan was on; Checkout comes back there with
// ?tipped=<id> or ?tipped=cancelled.
export async function createTipCheckout({ tipperId, tipperEmail, creatorId, amountCents, note, showName, origin, returnTo }) {
  if (!tipperId) throw new Error('Sign in to tip.');
  if (!creatorId) throw new Error('Who are you tipping?');
  if (tipperId === creatorId) throw new Error('That’s you.');
  const settings = await getTipSettings();
  const check = validateTipInput({ amountCents, note, showName }, { maxCents: settings.maxCents });
  if (!check.ok) throw new Error(check.error);
  const tipping = await getTipping(creatorId, { viewerId: tipperId, internal: true });
  if (!tipping.enabled) {
    if (tipping.reason === 'payouts not ready') throw new Error('This creator isn’t set up to take tips yet.');
    if (tipping.reason === 'suspended') throw new Error(`Tipping is switched off for your account. Write to ${SITE.contactEmail} if you think that’s a mistake.`);
    if (tipping.reason === 'blocked') throw new Error('You can’t tip this person.');
    throw new Error('This person can’t take tips.');
  }
  const account = await getPayoutAccount(creatorId);

  const q = tipQuote(check.amountCents, settings.cutPercent, settings.cutMaxCents);
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('creator_tips').insert({
    creator_id: creatorId,
    tipper_id: tipperId,
    tipper_email: tipperEmail || null,
    amount_cents: q.amountCents,
    platform_cut_percent: settings.cutPercent,
    platform_cut_cents: q.cutCents,
    creator_payout_cents: q.creatorCents,
    fee_cover_cents: q.feeCents,
    total_charged_cents: q.totalCents,
    note: check.note,
    show_name: check.showName,
    status: 'pending'
  }).select('*').single();
  if (error) {
    if (isMissingTable(error)) throw new Error('Tips aren’t switched on yet (migration 088).');
    // The database's own words name tables and columns; the fan gets a
    // plain line and the log keeps the real one (security round, 2026-10-26).
    console.error('createTipCheckout insert:', error.message);
    throw new Error('Couldn’t start the tip right now. Try again in a moment.');
  }

  const back = safeTipReturn(returnTo, `/profile/${creatorId}`);
  const join = back.includes('?') ? '&' : '?';
  const metadata = { type: 'tip', tip_id: row.id, creator_id: creatorId, tipper_id: tipperId, amount_cents: String(q.amountCents), fee_cover_cents: String(q.feeCents), cut_percent: String(settings.cutPercent), cut_max_cents: String(settings.cutMaxCents) };
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      submit_type: 'pay',
      customer_email: tipperEmail || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: q.totalCents,
          product_data: {
            name: `Tip for ${tipping.creatorName}`,
            description: `${dollars(q.amountCents)} tip + ${dollars(q.feeCents)} card processing`
          }
        }
      }],
      payment_intent_data: {
        // Destination charge: the creator's account receives the total
        // minus this fee, i.e. exactly tip − the studio's cut.
        application_fee_amount: q.cutCents + q.feeCents,
        transfer_data: { destination: account.stripeAccountId },
        description: `Tip for ${tipping.creatorName} on ${SITE.name}`,
        metadata
      },
      metadata,
      success_url: `${origin}${back}${join}tipped=${row.id}`,
      cancel_url: `${origin}${back}${join}tipped=cancelled`
    });
  } catch (err) {
    await supabase.from('creator_tips').update({ status: 'failed', failed_reason: `checkout not created: ${err.message}`.slice(0, 300) }).eq('id', row.id);
    console.error('createTipCheckout stripe:', err.message);
    throw new Error('Stripe couldn’t start the tip. Try again in a moment.');
  }
  await supabase.from('creator_tips').update({ stripe_checkout_session_id: session.id }).eq('id', row.id);
  return { url: session.url, tipId: row.id, quote: q };
}

async function tellCreator(row) {
  const supabase = getSupabase();
  const [identities, lastEmailed] = await Promise.all([
    getPublicIdentities([row.tipper_id]).catch(() => ({})),
    supabase.from('creator_tips').select('emailed_at').eq('creator_id', row.creator_id).eq('tipper_id', row.tipper_id).not('emailed_at', 'is', null).neq('id', row.id).order('emailed_at', { ascending: false }).limit(1).maybeSingle()
  ]);
  const who = tipperLabel(row, identities[row.tipper_id] ? identities[row.tipper_id].displayName : null);
  const note = row.note && !row.note_hidden ? ` “${row.note}”` : '';
  await notifyCreator({
    userId: row.creator_id,
    type: 'tip',
    href: '/creator/money',
    message: `${who} tipped you ${dollars(row.amount_cents)}.${note} ${dollars(row.creator_payout_cents)} is in your Stripe balance.`
  });
  const last = lastEmailed && lastEmailed.data ? lastEmailed.data.emailed_at : null;
  if (!tipEmailDue(last)) return;
  const to = await getUserEmail(row.creator_id).catch(() => null);
  if (!to) return;
  await sendEmail({
    to,
    subject: `A ${dollars(row.amount_cents)} tip from ${who} on ${SITE.name}`,
    html: `<p>${esc(who)} tipped you <strong>${dollars(row.amount_cents)}</strong>.${row.note && !row.note_hidden ? `</p><blockquote>${esc(row.note)}</blockquote><p>` : ' '}${dollars(row.creator_payout_cents)} is in your Stripe balance now (they covered the card fee; ${SITE.name} kept ${dollars(row.platform_cut_cents)}).</p><p><a href="${siteUrl()}/creator/money">Your Money page</a></p>`
  }).catch((err) => console.error('tip email failed:', err.message));
  const stamp = await supabase.from('creator_tips').update({ emailed_at: new Date().toISOString() }).eq('id', row.id);
  if (stamp.error && !isMissingColumn(stamp.error)) console.error('tip emailed_at:', stamp.error.message);
}

// Webhook checkout.session.completed (metadata.type = tip): the pending
// row becomes the tip that counts. Idempotent on the session id.
export async function completeTipFromSession(session) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  const patch = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_charged_cents: Number.isFinite(session.amount_total) ? session.amount_total : undefined,
    stripe_payment_intent_id: piOf(session.payment_intent),
    stripe_checkout_session_id: session.id
  };
  const bySession = await supabase.from('creator_tips').select('*').eq('stripe_checkout_session_id', session.id).maybeSingle();
  let row = bySession.data || null;
  if (!row && meta.tip_id) {
    const byId = await supabase.from('creator_tips').select('*').eq('id', meta.tip_id).maybeSingle();
    row = byId.data || null;
  }
  if (row && row.status === 'completed') return { duplicate: true, id: row.id };
  if (row) {
    const { data: updated, error } = await supabase.from('creator_tips').update(patch).eq('id', row.id).select('*').single();
    if (error) throw new Error(error.message);
    await tellCreator(updated).catch((err) => console.error('tellCreator failed:', err.message));
    return { id: updated.id };
  }
  // No row at all: rebuild it from Stripe's metadata.
  const amountCents = Number(meta.amount_cents);
  if (!meta.creator_id || !meta.tipper_id || !Number.isFinite(amountCents)) throw new Error('Completed tip session is missing metadata.');
  const cut = Number(meta.cut_percent);
  const cutMax = Number(meta.cut_max_cents);
  const q = tipQuote(amountCents, Number.isFinite(cut) ? cut : DEFAULT_TIP_CUT_PERCENT, Number.isFinite(cutMax) ? cutMax : undefined);
  const { data: made, error } = await supabase.from('creator_tips').insert({
    creator_id: meta.creator_id,
    tipper_id: meta.tipper_id,
    tipper_email: session.customer_details ? session.customer_details.email : null,
    amount_cents: q.amountCents,
    platform_cut_percent: q.cutPercent,
    platform_cut_cents: q.cutCents,
    creator_payout_cents: q.creatorCents,
    fee_cover_cents: Number(meta.fee_cover_cents) || q.feeCents,
    show_name: false,
    ...patch
  }).select('*').single();
  if (error) throw new Error(error.message);
  await tellCreator(made).catch((err) => console.error('tellCreator failed:', err.message));
  return { id: made.id, recreated: true };
}

// Webhook checkout.session.expired: nobody finished paying.
export async function failTipFromSession(session, reason = 'checkout expired') {
  const { error } = await getSupabase().from('creator_tips').update({ status: 'failed', failed_reason: reason }).eq('stripe_checkout_session_id', session.id).eq('status', 'pending');
  if (error && !isMissingTable(error)) throw new Error(error.message);
}

// Admin refund: full, final. reverse_transfer takes the creator's share
// back; refund_application_fee returns the studio's cut; Stripe keeps
// its processing fee, which the studio absorbs.
export async function refundTip({ tipId, adminEmail, reason }) {
  if (!tipId) throw new Error('tipId is required.');
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('creator_tips').select('*').eq('id', tipId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('Tip not found.');
  if (row.status === 'refunded') return { alreadyRefunded: true, tip: rowToTip(row) };
  if (row.status !== 'completed') throw new Error(`Only a paid tip can be refunded (this one is ${row.status}).`);
  if (!row.stripe_payment_intent_id) throw new Error('This tip has no Stripe payment attached.');
  const stripe = getStripe();
  const refund = await stripe.refunds.create(
    { payment_intent: row.stripe_payment_intent_id, reverse_transfer: true, refund_application_fee: true, metadata: { type: 'tip', tip_id: row.id, creator_id: row.creator_id } },
    { idempotencyKey: `tip-refund-${row.id}` }
  );
  const patch = { status: 'refunded', refunded_at: new Date().toISOString(), refunded_by: adminEmail || null, refund_reason: String(reason || '').trim().slice(0, 300) || null };
  const { data: updated, error: updateError } = await supabase.from('creator_tips').update(patch).eq('id', row.id).select('*').single();
  if (updateError) throw new Error(`Stripe refunded it (${refund.id}) but the record didn’t update: ${updateError.message}`);
  await notifyCreator({ userId: row.creator_id, type: 'tip_refunded', href: '/creator/money', message: `${SITE.name} refunded a ${dollars(row.amount_cents)} tip${patch.refund_reason ? ` (${patch.refund_reason})` : ''}. The ${dollars(row.creator_payout_cents)} was taken back from your Stripe balance.` }).catch(() => {});
  await notifyCreator({ userId: row.tipper_id, type: 'tip_refunded', href: '/account', message: `Your ${dollars(row.amount_cents)} tip was refunded by ${SITE.name}. ${dollars(row.total_charged_cents || row.amount_cents + row.fee_cover_cents)} goes back to your card in a few days.` }).catch(() => {});
  return { refundId: refund.id, tip: rowToTip(updated) };
}

// Webhook charge.refunded: a full refund made in the Stripe Dashboard.
export async function refundTipFromCharge(charge) {
  const pi = piOf(charge.payment_intent);
  if (!pi || !charge.refunded) return { ignored: true };
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('creator_tips').select('id, status').eq('stripe_payment_intent_id', pi).maybeSingle();
  if (error) {
    if (isMissingTable(error) || isMissingColumn(error)) return { ignored: true };
    throw new Error(error.message);
  }
  if (!row) return { ignored: true };
  if (row.status === 'refunded') return { duplicate: true, id: row.id };
  const { error: updateError } = await supabase.from('creator_tips').update({ status: 'refunded', refunded_at: new Date().toISOString(), refunded_by: 'stripe', refund_reason: 'refunded in Stripe' }).eq('id', row.id);
  if (updateError) throw new Error(updateError.message);
  return { id: row.id };
}

// The creator hides (or shows again) a note on their own Money page.
export async function setTipNoteHidden({ creatorId, tipId, hidden }) {
  const { data, error } = await getSupabase().from('creator_tips').update({ note_hidden: Boolean(hidden) }).eq('id', tipId).eq('creator_id', creatorId).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Tip not found.');
  return { ok: true };
}

// Every tip that counts (or counted) for a creator, for the Money page.
export async function getTipsForCreator(creatorId) {
  const { data, error } = await getSupabase().from('creator_tips').select('*').eq('creator_id', creatorId).in('status', ['completed', 'refunded', 'disputed']).order('completed_at', { ascending: false }).limit(2000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return data || [];
}

// One of the fan's own tips, any status: the "Thank you" banner reads it
// on the way back from Checkout (the webhook may not have landed yet).
export async function getOwnTip(tipperId, tipId) {
  if (!tipperId || !tipId) return null;
  const { data, error } = await getSupabase().from('creator_tips').select('*').eq('id', tipId).eq('tipper_id', tipperId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const names = await getPublicIdentities([data.creator_id]).catch(() => ({}));
  return { ...rowToTip(data), creatorName: names[data.creator_id] ? names[data.creator_id].displayName : 'the creator' };
}

// The fan's side: tips they sent, for the account page.
export async function getTipsSent(tipperId) {
  const { data, error } = await getSupabase().from('creator_tips').select('*').eq('tipper_id', tipperId).in('status', ['completed', 'refunded']).order('completed_at', { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data || [];
  const names = await getPublicIdentities(rows.map((r) => r.creator_id)).catch(() => ({}));
  return rows.map((r) => ({ ...rowToTip(r), creatorName: names[r.creator_id] ? names[r.creator_id].displayName : 'A creator' }));
}

// /admin/tips: recent tips with both names, and the open reports on notes.
export async function listTipsForAdmin({ limit = 100 } = {}) {
  const supabase = getSupabase();
  const [tips, reports] = await Promise.all([
    supabase.from('creator_tips').select('*').in('status', ['completed', 'refunded', 'disputed']).order('completed_at', { ascending: false }).limit(limit),
    supabase.from('content_reports').select('id, target_id, reporter_id, reason, created_at').eq('target_type', 'tip').eq('status', 'open').order('created_at', { ascending: false }).limit(100)
  ]);
  if (tips.error) {
    if (isMissingTable(tips.error)) return { available: false, recent: [], reported: [], monthCents: 0, monthKeptCents: 0 };
    throw new Error(tips.error.message);
  }
  const rows = tips.data || [];
  const reportRows = reports.error ? [] : reports.data || [];
  const reportedIds = reportRows.map((r) => r.target_id).filter((id) => !rows.some((t) => t.id === id));
  const extra = reportedIds.length ? await supabase.from('creator_tips').select('*').in('id', reportedIds) : { data: [] };
  const all = [...rows, ...(extra.data || [])];
  const ids = [...new Set(all.flatMap((t) => [t.creator_id, t.tipper_id]).concat(reportRows.map((r) => r.reporter_id)).filter(Boolean))];
  const names = ids.length ? await getPublicIdentities(ids).catch(() => ({})) : {};
  const nameOf = (id) => (names[id] ? names[id].displayName : 'Someone');
  const decorate = (t) => ({ ...rowToTip(t), creatorName: nameOf(t.creator_id), tipperName: nameOf(t.tipper_id), tipperEmail: t.tipper_email || null });
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const thisMonth = rows.filter((t) => t.status !== 'refunded' && (t.completed_at || '') >= monthStart);
  return {
    available: true,
    recent: rows.map(decorate),
    reported: reportRows.map((r) => {
      const tip = all.find((t) => t.id === r.target_id);
      return { reportId: r.id, reason: r.reason, reportedAt: r.created_at, reporterName: nameOf(r.reporter_id), tip: tip ? decorate(tip) : null };
    }).filter((r) => r.tip),
    monthCents: thisMonth.reduce((s, t) => s + (Number(t.amount_cents) || 0), 0),
    monthKeptCents: thisMonth.reduce((s, t) => s + (Number(t.platform_cut_cents) || 0), 0)
  };
}

// Admin: hide a reported note for good (the creator can't un-hide an
// admin-hidden one from their page: the row flips to note_hidden and the
// report closes).
export async function adminHideTipNote({ tipId, adminId }) {
  const supabase = getSupabase();
  const { error } = await supabase.from('creator_tips').update({ note_hidden: true }).eq('id', tipId);
  if (error) throw new Error(error.message);
  await supabase.from('content_reports').update({ status: 'upheld', resolved_by: adminId || null, resolved_at: new Date().toISOString() }).eq('target_type', 'tip').eq('target_id', tipId).eq('status', 'open');
  return { ok: true };
}

export async function adminDismissTipReports({ tipId, adminId }) {
  const { error } = await getSupabase().from('content_reports').update({ status: 'dismissed', resolved_by: adminId || null, resolved_at: new Date().toISOString() }).eq('target_type', 'tip').eq('target_id', tipId).eq('status', 'open');
  if (error) throw new Error(error.message);
  return { ok: true };
}
