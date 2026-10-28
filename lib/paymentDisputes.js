import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { notifyCreator, sendEmail } from './notify';
import { dollars } from './donationMath';
import { SITE } from './siteConfig';

// Chargebacks on Pitch backings and location bookings (migration 096;
// Jose, 2026-10-18), tips (101), secured crew pay (113) and title sales
// (114). The destination charges pull the money (plus Stripe's dispute
// fee) from the platform's balance, never from the creator's or host's —
// whatever they were sent stays with them unless we reverse their transfer.
//
//   Backing: status 'disputed' (so it stops counting toward the pitch),
//            the creator's share is reversed straight away, and paid back
//            if the bank sides with us (status back to 'completed').
//   Tip, title sale: the same as backing (a disputed sale stops granting
//            playback until the bank rules for us).
//   Booking: the booking itself is untouched (the shoot may have
//            happened); an admin decides on /admin/locations whether to
//            take the host's payout back or let the studio absorb it. A
//            taken-back payout is paid back if we win.
// The creator/host gets a notification either way, and the studio's
// address an email. Every Stripe call carries an idempotency key, so a
// webhook retry can't reverse or repay twice.

const piOf = (x) => (typeof x === 'string' ? x : (x && x.id) || null);
const adminTo = () => process.env.STUDIO_MONEY_NOTIFY_EMAIL || SITE.contactEmail;
const site = () => SITE.productionDomain || 'https://www.studiotapatv.site';
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The transfer a destination charge made to the connected account.
async function transferForCharge(stripe, chargeId) {
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId);
  const id = piOf(charge.transfer);
  return id ? stripe.transfers.retrieve(id) : null;
}

// Reverse up to `cents` of a transfer (never more than is left on it).
async function reverseTransfer(stripe, transfer, cents, key, metadata) {
  const left = Math.max(0, (transfer.amount || 0) - (transfer.amount_reversed || 0));
  const amount = Math.min(Math.max(0, Math.round(cents)), left);
  if (amount <= 0) return 0;
  await stripe.transfers.createReversal(transfer.id, { amount, metadata }, { idempotencyKey: key });
  return amount;
}

async function payBack(stripe, transferId, cents, key, metadata) {
  if (!transferId || cents <= 0) return null;
  const original = await stripe.transfers.retrieve(transferId);
  const destination = piOf(original.destination);
  if (!destination) return null;
  const t = await stripe.transfers.create(
    { amount: cents, currency: original.currency || 'usd', destination, transfer_group: original.transfer_group || undefined, metadata },
    { idempotencyKey: key }
  );
  return t.id;
}

async function findRows(supabase, pi) {
  const [d, b, t, c, p] = await Promise.all([
    supabase.from('pitch_donations').select('*').eq('stripe_charge_id', pi).maybeSingle(),
    supabase.from('location_requests').select('*').eq('stripe_payment_intent_id', pi).maybeSingle(),
    // Tips (migration 101 adds the dispute columns); a database without
    // the table or the column just has no tip to match.
    supabase.from('creator_tips').select('*').eq('stripe_payment_intent_id', pi).maybeSingle(),
    // Secured crew pay (migration 113 adds the dispute columns): same rule.
    supabase.from('crew_payments').select('*').eq('stripe_payment_intent_id', pi).maybeSingle(),
    // Buy to own (migration 114 adds the dispute columns): same rule.
    supabase.from('purchases').select('*').eq('stripe_payment_intent_id', pi).maybeSingle()
  ]);
  if (d.error && !/dispute/.test(d.error.message)) throw new Error(d.error.message);
  if (b.error && !/dispute/.test(b.error.message)) throw new Error(b.error.message);
  return { donation: d.data || null, booking: b.data || null, tip: t.error ? null : t.data || null, crewPay: c.error ? null : c.data || null, purchase: p.error ? null : p.data || null };
}

const titleHref = (p) => (p.target_type === 'series' ? `/series/${p.target_id}` : `/episode/${p.target_id}`);

async function callTitle(supabase, callId) {
  const { data } = await supabase.from('crew_calls').select('title').eq('id', callId).maybeSingle();
  return data ? data.title : 'a call';
}

async function pitchInfo(supabase, pitchId) {
  const { data } = await supabase.from('pitches').select('id, title, created_by').eq('id', pitchId).maybeSingle();
  return data || { id: pitchId, title: 'your pitch', created_by: null };
}
async function placeTitle(supabase, locationId) {
  const { data } = await supabase.from('locations').select('title').eq('id', locationId).maybeSingle();
  return data ? data.title : 'a place';
}

// charge.dispute.created
export async function openDispute(dispute, { stripe = getStripe() } = {}) {
  const pi = piOf(dispute.payment_intent);
  if (!pi) return { ignored: true };
  const supabase = getSupabase();
  const { donation, booking, tip, crewPay, purchase } = await findRows(supabase, pi);
  const now = new Date().toISOString();
  const base = { dispute_id: dispute.id, dispute_status: 'open', disputed_at: now, dispute_amount_cents: dispute.amount || null };

  if (purchase) {
    // A title sale (security round 2, 2026-10-28; migration 114): like a
    // tip — it stops counting (only 'completed' rows grant playback, so
    // the buyer loses the title while the bank decides), the creator's
    // share is taken back from their transfer at once, and a won dispute
    // puts both back (closeDispute). Before 114 the status 'disputed'
    // and the columns don't exist: the dispute is recorded nowhere, the
    // studio is emailed, and Stripe gets its 200.
    if (purchase.dispute_id === dispute.id && purchase.clawback_at) return { duplicate: true, id: purchase.id };
    const counted = purchase.status === 'completed' || purchase.status === 'disputed';
    if (purchase.dispute_id !== dispute.id) {
      const { error } = await supabase.from('purchases').update({ ...base, ...(counted ? { status: 'disputed' } : {}) }).eq('id', purchase.id);
      if (error) {
        if (/dispute|status/.test(error.message || '')) {
          console.error('openDispute: migration 114 not run — purchase dispute not recorded for', purchase.id);
          await sendEmail({ to: adminTo(), subject: `Chargeback on a title sale (run migration 114): ${dollars(purchase.paid_cents)} for “${purchase.title || 'a title'}”`, html: `<p>The buyer’s bank opened a dispute on a ${dollars(purchase.paid_cents)} sale of <strong>${esc(purchase.title || 'a title')}</strong>, but the database is behind on migration 114, so nothing was recorded and the buyer keeps the title. Run the migration, then handle this one in the Stripe Dashboard.</p>` });
          return { skipped: 'migration 114 not run', id: purchase.id };
        }
        throw new Error(error.message);
      }
    }
    let clawback = 0;
    let transferId = purchase.dispute_transfer_id || null;
    if (counted && !purchase.house) {
      const transfer = await transferForCharge(stripe, piOf(dispute.charge));
      if (transfer) {
        transferId = transfer.id;
        clawback = await reverseTransfer(stripe, transfer, purchase.creator_cents, `dispute-clawback-purchase-${purchase.id}`, { type: 'title_purchase_dispute', purchase_id: purchase.id, dispute_id: dispute.id });
      }
    }
    const { error: markError } = await supabase.from('purchases').update({ dispute_transfer_id: transferId, clawback_cents: clawback, clawback_at: now }).eq('id', purchase.id);
    if (markError) throw new Error(`Took back ${dollars(clawback)} in Stripe but the record didn’t update: ${markError.message}`);
    if (!purchase.house) {
      await notifyCreator({
        userId: purchase.creator_id,
        type: 'purchase_disputed',
        href: '/creator/money',
        message: `A ${dollars(purchase.paid_cents)} sale of ${purchase.title || 'your title'} was disputed by the buyer’s bank.${clawback ? ` Your ${dollars(clawback)} share was taken back while the bank decides; if it rules for us, it comes back to you.` : ''}`
      });
    }
    await sendEmail({ to: adminTo(), subject: `Chargeback: ${dollars(purchase.paid_cents)} title sale of “${purchase.title || 'a title'}”`, html: `<p>The buyer’s bank opened a dispute (${esc(dispute.reason || 'no reason given')}) on a ${dollars(purchase.paid_cents)} sale of <strong>${esc(purchase.title || 'a title')}</strong>.</p><p>The buyer no longer owns the title${clawback ? `, and the creator’s ${dollars(clawback)} share was taken back` : ''}. Answer the dispute with evidence (the purchase, how much of the title was watched) in the Stripe Dashboard before its deadline.</p><p><a href="${site()}/admin/purchases">Title sales admin</a></p>` });
    return { kind: 'purchase', id: purchase.id, clawbackCents: clawback };
  }

  if (crewPay) {
    // Secured crew pay (migration 113): the poster's own charge, sitting
    // whole in the studio's balance. Held → 'disputed' so nothing can be
    // released while the bank decides; the worker is told. Already
    // released → the worker keeps what they were paid (the poster had
    // confirmed the work), the dispute is recorded and the admin decides
    // in the Stripe Dashboard whether to reverse the transfer.
    if (crewPay.dispute_id === dispute.id) return { duplicate: true, id: crewPay.id };
    const held = crewPay.status === 'held';
    const { error } = await supabase.from('crew_payments').update({ ...base, ...(held ? { status: 'disputed' } : {}), updated_at: now }).eq('id', crewPay.id);
    if (error) throw new Error(error.message);
    const title = await callTitle(supabase, crewPay.call_id);
    if (held) {
      await notifyCreator({
        userId: crewPay.worker_id,
        type: 'crew_pay_disputed',
        href: `/crew/calls/${crewPay.call_id}`,
        message: `The poster’s bank is disputing the ${dollars(crewPay.amount_cents)} secured for you on ${title}. It stays on hold until the bank decides; if it rules for us, it goes back to being held for you.`
      });
    }
    await sendEmail({ to: adminTo(), subject: `Chargeback: ${dollars(crewPay.total_charged_cents)} crew pay on “${title}”`, html: `<p>The poster’s bank opened a dispute (${esc(dispute.reason || 'no reason given')}) on the ${dollars(crewPay.total_charged_cents)} charge securing ${dollars(crewPay.amount_cents)} for a crew member on <strong>${esc(title)}</strong>.</p><p>${held ? 'The payment was still held, so it is marked disputed and nothing will be released until the bank rules.' : crewPay.status === 'released' ? `The ${dollars(crewPay.amount_cents)} had already been sent to the worker after the poster confirmed the work; nothing was taken back. If the bank rules for the poster and you want it back, reverse the transfer in the Stripe Dashboard.` : `The payment is ${esc(crewPay.status)}.`} Answer the dispute with evidence (the booking, the poster’s “worked it” confirmation) in the Stripe Dashboard before its deadline.</p><p><a href="${site()}/admin/crew">Crew admin</a></p>` });
    return { kind: 'crewPay', id: crewPay.id, held };
  }

  if (tip) {
    // A tip follows backing: it stops counting and the creator's share
    // is taken back at once; a won dispute puts both back (closeDispute).
    if (tip.dispute_id === dispute.id && tip.clawback_at) return { duplicate: true, id: tip.id };
    const counted = tip.status === 'completed' || tip.status === 'disputed';
    if (tip.dispute_id !== dispute.id) {
      const { error } = await supabase.from('creator_tips').update({ ...base, ...(counted ? { status: 'disputed' } : {}) }).eq('id', tip.id);
      if (error) throw new Error(error.message);
    }
    let clawback = 0;
    let transferId = tip.dispute_transfer_id || null;
    if (counted) {
      const transfer = await transferForCharge(stripe, piOf(dispute.charge));
      if (transfer) {
        transferId = transfer.id;
        clawback = await reverseTransfer(stripe, transfer, tip.creator_payout_cents, `dispute-clawback-tip-${tip.id}`, { type: 'tip_dispute', tip_id: tip.id, dispute_id: dispute.id });
      }
    }
    const { error: markError } = await supabase.from('creator_tips').update({ dispute_transfer_id: transferId, clawback_cents: clawback, clawback_at: now }).eq('id', tip.id);
    if (markError) throw new Error(`Took back ${dollars(clawback)} in Stripe but the record didn’t update: ${markError.message}`);
    await notifyCreator({
      userId: tip.creator_id,
      type: 'tip_disputed',
      href: '/creator/money',
      message: `A ${dollars(tip.amount_cents)} tip was disputed by the fan’s bank.${clawback ? ` Your ${dollars(clawback)} share was taken back while the bank decides; if it rules for us, it comes back to you.` : ''}`
    });
    await sendEmail({ to: adminTo(), subject: `Chargeback: ${dollars(tip.amount_cents)} tip`, html: `<p>The fan’s bank opened a dispute (${esc(dispute.reason || 'no reason given')}) on a ${dollars(tip.amount_cents)} tip.</p><p>The tip no longer counts${clawback ? `, and the creator’s ${dollars(clawback)} share was taken back` : ''}. Answer the dispute with evidence in the Stripe Dashboard before its deadline.</p><p><a href="${site()}/admin/tips">Tips admin</a></p>` });
    return { kind: 'tip', id: tip.id, clawbackCents: clawback };
  }

  if (donation) {
    if (donation.dispute_id === dispute.id && donation.clawback_at) return { duplicate: true, id: donation.id };
    const counted = donation.status === 'completed' || donation.status === 'disputed';
    if (donation.dispute_id !== dispute.id) {
      const { error } = await supabase.from('pitch_donations').update({ ...base, ...(counted ? { status: 'disputed' } : {}) }).eq('id', donation.id);
      if (error) throw new Error(error.message);
    }
    // clawback_at marks the dispute as handled (even when nothing was
    // taken back), so a webhook retry after a hiccup finishes the job
    // and sends the notices exactly once.
    let clawback = 0;
    let transferId = donation.dispute_transfer_id || null;
    if (counted) {
      const transfer = await transferForCharge(stripe, piOf(dispute.charge));
      if (transfer) {
        transferId = transfer.id;
        clawback = await reverseTransfer(stripe, transfer, donation.creator_payout_cents, `dispute-clawback-donation-${donation.id}`, { type: 'pitch_donation_dispute', donation_id: donation.id, dispute_id: dispute.id });
      }
    }
    const { error: markError } = await supabase.from('pitch_donations').update({ dispute_transfer_id: transferId, clawback_cents: clawback, clawback_at: now }).eq('id', donation.id);
    if (markError) throw new Error(`Took back ${dollars(clawback)} in Stripe but the record didn’t update: ${markError.message}`);
    const pitch = await pitchInfo(supabase, donation.pitch_id);
    await notifyCreator({
      userId: pitch.created_by,
      type: 'backing_disputed',
      pitchId: pitch.id,
      href: '/creator/pitch/dashboard',
      message: `A ${dollars(donation.amount_cents)} backing on “${pitch.title}” was disputed by the backer’s bank.${clawback ? ` Your ${dollars(clawback)} share was taken back while the bank decides; if it rules for us, it comes back to you.` : ''}`
    });
    await sendEmail({ to: adminTo(), subject: `Chargeback: ${dollars(donation.amount_cents)} backing on “${pitch.title}”`, html: `<p>The backer’s bank opened a dispute (${esc(dispute.reason || 'no reason given')}) on a ${dollars(donation.amount_cents)} backing of <strong>${esc(pitch.title)}</strong>.</p><p>The backing no longer counts toward the pitch${clawback ? `, and the creator’s ${dollars(clawback)} share was taken back` : ''}. Answer the dispute with evidence in the Stripe Dashboard before its deadline.</p><p><a href="${site()}/admin/pitch-room">Pitches &amp; comments</a></p>` });
    return { kind: 'donation', id: donation.id, clawbackCents: clawback };
  }

  if (booking) {
    if (booking.dispute_id === dispute.id) return { duplicate: true, id: booking.id };
    const { error } = await supabase.from('location_requests').update(base).eq('id', booking.id);
    if (error) throw new Error(error.message);
    const title = await placeTitle(supabase, booking.location_id);
    await notifyCreator({
      userId: booking.host_id,
      type: 'booking_disputed',
      href: `/locations/requests/${booking.id}`,
      message: `The producer’s bank disputed the payment for the booking at ${title} (${booking.starts_on}). Nothing changes for you yet; Studio Tapa will be in touch.`
    });
    await sendEmail({ to: adminTo(), subject: `Chargeback: booking at ${title}`, html: `<p>The producer’s bank opened a dispute (${esc(dispute.reason || 'no reason given')}) on the ${dollars(booking.total_charged_cents || dispute.amount)} booking at <strong>${esc(title)}</strong> (${esc(booking.starts_on)} to ${esc(booking.ends_on)}).</p><p>Decide on Locations admin whether to take the host’s ${dollars(booking.host_payout_cents)} payout back or let the studio absorb it, and answer the dispute in the Stripe Dashboard before its deadline.</p><p><a href="${site()}/admin/locations">Locations admin</a></p>` });
    return { kind: 'booking', id: booking.id };
  }
  return { ignored: true };
}

// charge.dispute.closed: won (or an inquiry closed without a chargeback)
// puts things back; lost leaves them as they are.
export async function closeDispute(dispute, { stripe = getStripe() } = {}) {
  const pi = piOf(dispute.payment_intent);
  if (!pi) return { ignored: true };
  const supabase = getSupabase();
  const { donation, booking, tip, crewPay, purchase } = await findRows(supabase, pi);
  const won = dispute.status === 'won' || dispute.status === 'warning_closed';
  const outcome = won ? 'won' : 'lost';
  const now = new Date().toISOString();

  if (purchase && purchase.dispute_id) {
    const clawed = Number(purchase.clawback_cents) || 0;
    const returned = Number(purchase.returned_cents) || 0;
    if (purchase.dispute_status === outcome && (!won || returned >= clawed)) return { duplicate: true, id: purchase.id };
    const owed = won ? Math.max(0, clawed - returned) : 0;
    const transferId = owed ? await payBack(stripe, purchase.dispute_transfer_id, owed, `dispute-return-purchase-${purchase.id}`, { type: 'title_purchase_dispute_won', purchase_id: purchase.id }) : null;
    const patch = { dispute_status: outcome, dispute_closed_at: now };
    // Won: the buyer owns the title again. Lost: it stays 'disputed' (the
    // bank's debit is what Studio money counts, never a refund).
    if (won && purchase.status === 'disputed') patch.status = 'completed';
    if (transferId) Object.assign(patch, { returned_cents: returned + owed, returned_at: now, returned_transfer_id: transferId });
    const { error } = await supabase.from('purchases').update(patch).eq('id', purchase.id);
    if (error) throw new Error(error.message);
    if (!purchase.house) {
      await notifyCreator({
        userId: purchase.creator_id,
        type: won ? 'purchase_dispute_won' : 'purchase_dispute_lost',
        href: '/creator/money',
        message: won
          ? `The bank ruled for us on the disputed ${dollars(purchase.paid_cents)} sale of ${purchase.title || 'your title'}. It counts again${transferId ? ` and your ${dollars(owed)} share is on its way back` : ''}.`
          : `The bank ruled for the buyer on the disputed ${dollars(purchase.paid_cents)} sale of ${purchase.title || 'your title'}, so that sale is gone for good.`
      });
    }
    return { kind: 'purchase', id: purchase.id, outcome, returnedCents: transferId ? owed : 0 };
  }

  if (crewPay && crewPay.dispute_id) {
    if (crewPay.dispute_status === outcome) return { duplicate: true, id: crewPay.id };
    const patch = { dispute_status: outcome, dispute_closed_at: now, updated_at: now };
    // Won: the money is back in the balance, so the pay is held again and
    // settles the normal way. Lost: the bank took it; the row stays
    // 'disputed' with dispute_status 'lost' (like a lost backing — it is
    // the dispute debit Studio money counts, not a refund), and the
    // worker is told.
    if (crewPay.status === 'disputed' && won) patch.status = 'held';
    const { error } = await supabase.from('crew_payments').update(patch).eq('id', crewPay.id);
    if (error) throw new Error(error.message);
    if (crewPay.status === 'disputed') {
      const title = await callTitle(supabase, crewPay.call_id);
      await notifyCreator({
        userId: crewPay.worker_id,
        type: won ? 'crew_pay_dispute_won' : 'crew_pay_dispute_lost',
        href: `/crew/calls/${crewPay.call_id}`,
        message: won
          ? `The bank ruled for us on the disputed pay for ${title}. The ${dollars(crewPay.amount_cents)} is held for you again and is sent once the poster confirms the work.`
          : `The bank ruled for the poster on the disputed pay for ${title}, so the ${dollars(crewPay.amount_cents)} secured for you is gone. Talk to the poster directly about the job.`
      });
    }
    return { kind: 'crewPay', id: crewPay.id, outcome };
  }

  if (tip && tip.dispute_id) {
    const clawed = Number(tip.clawback_cents) || 0;
    const returned = Number(tip.returned_cents) || 0;
    if (tip.dispute_status === outcome && (!won || returned >= clawed)) return { duplicate: true, id: tip.id };
    const owed = won ? Math.max(0, clawed - returned) : 0;
    const transferId = owed ? await payBack(stripe, tip.dispute_transfer_id, owed, `dispute-return-tip-${tip.id}`, { type: 'tip_dispute_won', tip_id: tip.id }) : null;
    const patch = { dispute_status: outcome, dispute_closed_at: now };
    if (won && tip.status === 'disputed') patch.status = 'completed';
    if (transferId) Object.assign(patch, { returned_cents: returned + owed, returned_at: now, returned_transfer_id: transferId });
    const { error } = await supabase.from('creator_tips').update(patch).eq('id', tip.id);
    if (error) throw new Error(error.message);
    await notifyCreator({
      userId: tip.creator_id,
      type: won ? 'tip_dispute_won' : 'tip_dispute_lost',
      href: '/creator/money',
      message: won
        ? `The bank ruled for us on the disputed ${dollars(tip.amount_cents)} tip. It counts again${transferId ? ` and your ${dollars(owed)} share is on its way back` : ''}.`
        : `The bank ruled for the fan on the disputed ${dollars(tip.amount_cents)} tip, so that tip is gone for good.`
    });
    return { kind: 'tip', id: tip.id, outcome, returnedCents: transferId ? owed : 0 };
  }

  if (donation && donation.dispute_id) {
    if (donation.dispute_status === outcome && (!won || donation.returned_cents >= donation.clawback_cents)) return { duplicate: true, id: donation.id };
    const owed = won ? Math.max(0, donation.clawback_cents - donation.returned_cents) : 0;
    const transferId = owed ? await payBack(stripe, donation.dispute_transfer_id, owed, `dispute-return-donation-${donation.id}`, { type: 'pitch_donation_dispute_won', donation_id: donation.id }) : null;
    const patch = { dispute_status: outcome, dispute_closed_at: now };
    if (won && donation.status === 'disputed') patch.status = 'completed';
    if (transferId) Object.assign(patch, { returned_cents: donation.returned_cents + owed, returned_at: now, returned_transfer_id: transferId });
    const { error } = await supabase.from('pitch_donations').update(patch).eq('id', donation.id);
    if (error) throw new Error(error.message);
    const pitch = await pitchInfo(supabase, donation.pitch_id);
    await notifyCreator({
      userId: pitch.created_by,
      type: won ? 'backing_dispute_won' : 'backing_dispute_lost',
      pitchId: pitch.id,
      href: '/creator/pitch/dashboard',
      message: won
        ? `The bank ruled for us on the disputed ${dollars(donation.amount_cents)} backing of “${pitch.title}”. It counts again${transferId ? ` and your ${dollars(owed)} share is on its way back` : ''}.`
        : `The bank ruled for the backer on the disputed ${dollars(donation.amount_cents)} backing of “${pitch.title}”, so that backing is gone for good.`
    });
    return { kind: 'donation', id: donation.id, outcome, returnedCents: transferId ? owed : 0 };
  }

  if (booking && booking.dispute_id) {
    if (booking.dispute_status === outcome && (!won || booking.returned_cents >= booking.clawback_cents)) return { duplicate: true, id: booking.id };
    const owed = won ? Math.max(0, booking.clawback_cents - booking.returned_cents) : 0;
    const transferId = owed ? await payBack(stripe, booking.dispute_transfer_id, owed, `dispute-return-booking-${booking.id}`, { type: 'location_booking_dispute_won', request_id: booking.id }) : null;
    const patch = { dispute_status: outcome, dispute_closed_at: now };
    if (transferId) Object.assign(patch, { returned_cents: booking.returned_cents + owed, returned_at: now, returned_transfer_id: transferId });
    const { error } = await supabase.from('location_requests').update(patch).eq('id', booking.id);
    if (error) throw new Error(error.message);
    const title = await placeTitle(supabase, booking.location_id);
    await notifyCreator({
      userId: booking.host_id,
      type: won ? 'booking_dispute_won' : 'booking_dispute_lost',
      href: `/locations/requests/${booking.id}`,
      message: won
        ? `The bank ruled for us on the disputed booking at ${title}.${transferId ? ` The ${dollars(owed)} taken back is on its way to you.` : ''}`
        : `The bank ruled for the producer on the disputed booking at ${title}.`
    });
    return { kind: 'booking', id: booking.id, outcome, returnedCents: transferId ? owed : 0 };
  }
  return { ignored: true };
}

// /admin/locations: take the host's payout back, or let the studio absorb
// the loss. Once only; not after the bank has ruled for us.
export async function decideBookingDispute({ requestId, decision, adminEmail }, { stripe = getStripe() } = {}) {
  if (!['clawback', 'absorb'].includes(decision)) throw new Error('decision must be clawback or absorb.');
  const supabase = getSupabase();
  const { data: booking, error } = await supabase.from('location_requests').select('*').eq('id', requestId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking || !booking.dispute_id) throw new Error('That booking has no dispute.');
  if (booking.dispute_decision) throw new Error('This dispute has already been decided.');
  if (booking.dispute_status === 'won') throw new Error('The bank already ruled for us, so there’s nothing to take back.');

  const now = new Date().toISOString();
  // Claim the decision first, so two admins can't both act.
  const { data: claimed, error: claimError } = await supabase
    .from('location_requests')
    .update({ dispute_decision: decision, dispute_decided_by: adminEmail || null, dispute_decided_at: now })
    .eq('id', booking.id)
    .is('dispute_decision', null)
    .select('id');
  if (claimError) throw new Error(claimError.message);
  if (!claimed || !claimed.length) throw new Error('This dispute has already been decided.');

  let clawback = 0;
  if (decision === 'clawback') {
    try {
      const pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
      const transfer = await transferForCharge(stripe, piOf(pi.latest_charge));
      if (transfer) {
        clawback = await reverseTransfer(stripe, transfer, booking.host_payout_cents, `dispute-clawback-booking-${booking.id}`, { type: 'location_booking_dispute', request_id: booking.id, dispute_id: booking.dispute_id });
        await supabase.from('location_requests').update({ dispute_transfer_id: transfer.id, clawback_cents: clawback, clawback_at: now }).eq('id', booking.id);
      }
    } catch (err) {
      // Nothing moved: release the decision so it can be tried again.
      await supabase.from('location_requests').update({ dispute_decision: null, dispute_decided_by: null, dispute_decided_at: null }).eq('id', booking.id);
      throw new Error(`Stripe couldn’t take it back: ${err.message}`);
    }
    const title = await placeTitle(supabase, booking.location_id);
    await notifyCreator({
      userId: booking.host_id,
      type: 'booking_dispute_clawback',
      href: `/locations/requests/${booking.id}`,
      message: `Because the producer’s bank disputed the booking at ${title}, ${dollars(clawback)} of your payout was taken back while the bank decides. If it rules for us, it comes back to you.`
    });
  }
  return { id: booking.id, decision, clawbackCents: clawback };
}

// Every booking that has ever been disputed, newest first, for the admin page.
export async function listBookingDisputes() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('location_requests')
    .select('id, location_id, host_id, producer_id, starts_on, ends_on, total_charged_cents, host_payout_cents, status, dispute_status, disputed_at, dispute_amount_cents, dispute_closed_at, dispute_decision, dispute_decided_by, clawback_cents, returned_cents')
    .not('dispute_status', 'is', null)
    .order('disputed_at', { ascending: false })
    .limit(100);
  if (error) {
    if (/dispute/.test(error.message)) return [];
    throw new Error(error.message);
  }
  const ids = [...new Set((data || []).map((r) => r.location_id))];
  const { data: places } = ids.length ? await supabase.from('locations').select('id, title').in('id', ids) : { data: [] };
  const titleOf = Object.fromEntries((places || []).map((p) => [p.id, p.title]));
  return (data || []).map((r) => ({
    id: r.id,
    placeTitle: titleOf[r.location_id] || 'A place',
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status,
    totalCents: r.total_charged_cents,
    hostPayoutCents: r.host_payout_cents,
    disputeStatus: r.dispute_status,
    disputedAt: r.disputed_at,
    disputeAmountCents: r.dispute_amount_cents,
    closedAt: r.dispute_closed_at,
    decision: r.dispute_decision,
    decidedBy: r.dispute_decided_by,
    clawbackCents: r.clawback_cents || 0,
    returnedCents: r.returned_cents || 0
  }));
}
