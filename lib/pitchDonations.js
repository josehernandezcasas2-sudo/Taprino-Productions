import { getSupabase } from './supabase';
import { getStripe } from './stripe';
import { getPayoutAccount, isPayoutReady } from './creatorPayouts';
import { splitDonation, dollars } from './donationMath';
import { SITE } from './siteConfig';

// Admin action, not creator-initiated — matches how Jose scoped this:
// admin approves each campaign for real, in-platform funding before it
// goes live, same review-gate pattern as every other creator-submitted
// thing on this platform. cutPercent is stored on the pitch itself so
// every future donation locks in whatever rate was in effect at that
// moment (see recordDonation) — this call only sets the rate going
// forward, it never touches past donations.
export async function enableFundingForPitch({ pitchId, cutPercent, adminEmail }) {
  if (!pitchId) throw new Error('pitchId is required.');
  if (!Number.isFinite(cutPercent) || cutPercent < 0 || cutPercent > 100) {
    throw new Error('Cut percent must be a number between 0 and 100.');
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitches')
    .update({ funding_enabled: true, platform_cut_percent: cutPercent, reviewed_by: adminEmail || null, reviewed_at: new Date().toISOString() })
    .eq('id', pitchId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function disableFundingForPitch(pitchId) {
  if (!pitchId) throw new Error('pitchId is required.');
  const supabase = getSupabase();
  const { error } = await supabase.from('pitches').update({ funding_enabled: false }).eq('id', pitchId);
  if (error) throw new Error(error.message);
}

function rowToDonation(row) {
  return {
    id: row.id,
    pitchId: row.pitch_id,
    donorUserId: row.donor_user_id,
    donorEmail: row.donor_email,
    amountCents: row.amount_cents,
    platformCutCents: row.platform_cut_cents,
    creatorPayoutCents: row.creator_payout_cents,
    feeCoverCents: row.fee_cover_cents || 0,
    totalChargedCents: row.total_charged_cents || null,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  };
}

/* ---------- the real thing: Stripe Checkout (migration 083) ---------- */

// Starts a backing: a pending donation row plus a Stripe Checkout
// session that charges the pledge + card fee, sends the creator their
// share (pledge minus the platform cut) through their Connect account,
// and keeps the cut + fee cover on the platform. The webhook
// (checkout.session.completed → completeDonationFromSession) is what
// marks it paid; nothing counts toward a total until then.
export async function createDonationCheckout({ pitchId, donorUserId, donorEmail, amountCents, origin }) {
  if (!pitchId || !donorUserId) throw new Error('pitchId and donorUserId are required.');
  if (!Number.isInteger(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) {
    throw new Error(`Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(MAX_DONATION_CENTS / 100).toLocaleString()}.`);
  }
  const supabase = getSupabase();
  const { data: pitch, error: pitchError } = await supabase
    .from('pitches')
    .select('id, title, status, funding_enabled, platform_cut_percent, created_by')
    .eq('id', pitchId)
    .maybeSingle();
  if (pitchError) throw new Error(pitchError.message);
  if (!pitch || pitch.status !== 'approved') throw new Error('Project not found.');
  if (!pitch.funding_enabled) throw new Error('This project isn’t taking backing yet.');
  if (pitch.created_by === donorUserId) throw new Error('That’s your own project.');

  const account = await getPayoutAccount(pitch.created_by);
  if (!isPayoutReady(account)) throw new Error('This project can’t take backing yet — the creator hasn’t finished payout setup.');

  const split = splitDonation(amountCents, pitch.platform_cut_percent || 0);
  const { data: row, error } = await supabase
    .from('pitch_donations')
    .insert({
      pitch_id: pitchId,
      donor_user_id: donorUserId,
      donor_email: donorEmail || null,
      amount_cents: split.amountCents,
      platform_cut_cents: split.platformCutCents,
      creator_payout_cents: split.creatorPayoutCents,
      fee_cover_cents: split.feeCoverCents,
      total_charged_cents: split.totalChargedCents,
      status: 'pending'
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  const stripe = getStripe();
  const metadata = {
    type: 'pitch_donation',
    donation_id: row.id,
    pitch_id: pitchId,
    donor_user_id: donorUserId,
    amount_cents: String(split.amountCents),
    fee_cover_cents: String(split.feeCoverCents)
  };
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      customer_email: donorEmail || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: split.totalChargedCents,
          product_data: {
            name: `Back “${pitch.title}”`,
            description: `${dollars(split.amountCents)} to the project + ${dollars(split.feeCoverCents)} card processing`
          }
        }
      }],
      payment_intent_data: {
        // Destination charge: the creator's account receives the total
        // minus this fee, i.e. exactly pledge − platform cut.
        application_fee_amount: split.platformCutCents + split.feeCoverCents,
        transfer_data: { destination: account.stripeAccountId },
        description: `Backing “${pitch.title}” on ${SITE.name}`,
        metadata
      },
      metadata,
      success_url: `${origin}/pitches/${pitchId}?backed=1`,
      cancel_url: `${origin}/pitches/${pitchId}?backed=cancelled`
    });
  } catch (err) {
    await supabase.from('pitch_donations').update({ status: 'failed', failed_reason: `checkout not created: ${err.message}`.slice(0, 300) }).eq('id', row.id);
    throw new Error(`Stripe couldn’t start the payment: ${err.message}`);
  }
  await supabase.from('pitch_donations').update({ stripe_checkout_session_id: session.id }).eq('id', row.id);
  return { url: session.url, donationId: row.id, split };
}

// Webhook: the session was paid. Idempotent — a completed row stays
// completed; a row the insert missed is recreated from the session's
// metadata so the money is never unaccounted for.
export async function completeDonationFromSession(session) {
  const supabase = getSupabase();
  const meta = session.metadata || {};
  const patch = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_charged_cents: Number.isFinite(session.amount_total) ? session.amount_total : undefined,
    stripe_charge_id: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
    stripe_checkout_session_id: session.id
  };
  const { data: existing } = await supabase.from('pitch_donations').select('id, status').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (existing) {
    if (existing.status === 'completed') return { duplicate: true, id: existing.id };
    const { error } = await supabase.from('pitch_donations').update(patch).eq('id', existing.id);
    if (error) throw new Error(error.message);
    return { id: existing.id };
  }
  if (meta.donation_id) {
    const { data: byId } = await supabase.from('pitch_donations').select('id, status').eq('id', meta.donation_id).maybeSingle();
    if (byId) {
      if (byId.status === 'completed') return { duplicate: true, id: byId.id };
      const { error } = await supabase.from('pitch_donations').update(patch).eq('id', byId.id);
      if (error) throw new Error(error.message);
      return { id: byId.id };
    }
  }
  // No row at all: rebuild it from what Stripe tells us.
  const amountCents = Number(meta.amount_cents);
  if (!meta.pitch_id || !meta.donor_user_id || !Number.isFinite(amountCents)) throw new Error('Completed donation session is missing metadata.');
  const { data: pitch } = await supabase.from('pitches').select('platform_cut_percent').eq('id', meta.pitch_id).maybeSingle();
  const split = splitDonation(amountCents, pitch ? pitch.platform_cut_percent || 0 : 0);
  const { data: row, error } = await supabase.from('pitch_donations').insert({
    pitch_id: meta.pitch_id,
    donor_user_id: meta.donor_user_id,
    donor_email: session.customer_details ? session.customer_details.email : null,
    amount_cents: split.amountCents,
    platform_cut_cents: split.platformCutCents,
    creator_payout_cents: split.creatorPayoutCents,
    fee_cover_cents: Number(meta.fee_cover_cents) || split.feeCoverCents,
    ...patch
  }).select('id').single();
  if (error) throw new Error(error.message);
  return { id: row.id, recreated: true };
}

// Webhook: nobody finished the Checkout page (Stripe expires it after
// 24 hours). Only a still-pending row changes.
export async function failDonationFromSession(session, reason = 'checkout expired') {
  const { error } = await getSupabase()
    .from('pitch_donations')
    .update({ status: 'failed', failed_reason: reason })
    .eq('stripe_checkout_session_id', session.id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
}

// The actual money split happens here, once, at donation time — not
// read live from pitches.platform_cut_percent anywhere else, so admin
// later changing a pitch's rate can never rewrite what a past donation
// already cost a donor or paid out to a creator. The database's own
// check constraint (amount_cents = platform_cut_cents +
// creator_payout_cents) is the real backstop against a rounding bug
// here ever silently corrupting stored financial data — see migration
// 057.
//
// No real Stripe charge happens in this function yet (see this
// session's payment research) — it records the donation and its split
// as 'pending'. Wiring an actual charge in front of this call, and
// moving status to 'completed' only once that charge succeeds, is the
// next real piece of work once Stripe Connect is actually integrated.
// Whole cents, $1 to $10,000 per pledge. The route checks the same so the
// person gets a clear message; this is the backstop.
export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 1000000;

export async function recordDonation({ pitchId, donorUserId, donorEmail, amountCents }) {
  if (!pitchId || !donorUserId) throw new Error('pitchId and donorUserId are required.');
  if (!Number.isInteger(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) {
    throw new Error(`Enter an amount between $${MIN_DONATION_CENTS / 100} and $${(MAX_DONATION_CENTS / 100).toLocaleString()}.`);
  }

  const supabase = getSupabase();
  const { data: pitch, error: pitchError } = await supabase
    .from('pitches')
    .select('id, funding_enabled, platform_cut_percent')
    .eq('id', pitchId)
    .maybeSingle();

  if (pitchError) throw new Error(pitchError.message);
  if (!pitch) throw new Error('Project not found.');
  if (!pitch.funding_enabled) throw new Error('This project isn\'t open for donations yet.');

  const cutPercent = pitch.platform_cut_percent || 0;
  // Cut rounds down, payout takes the remainder — guarantees the two
  // always sum to exactly amountCents even when the percentage produces
  // a fractional cent, satisfying the database's own check constraint
  // without relying on floating-point rounding to land exactly right.
  const platformCutCents = Math.floor((amountCents * cutPercent) / 100);
  const creatorPayoutCents = amountCents - platformCutCents;

  const { data, error } = await supabase
    .from('pitch_donations')
    .insert({
      pitch_id: pitchId,
      donor_user_id: donorUserId,
      donor_email: donorEmail || null,
      amount_cents: amountCents,
      platform_cut_cents: platformCutCents,
      creator_payout_cents: creatorPayoutCents
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToDonation(data);
}

// Paid donations only (status 'completed') — pending Checkouts, failed
// and refunded ones never count toward what a project shows as raised.
export async function getDonationsForPitch(pitchId, { status = 'completed' } = {}) {
  if (!pitchId) return [];
  const supabase = getSupabase();
  let q = supabase
    .from('pitch_donations')
    .select('*')
    .eq('pitch_id', pitchId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) {
    console.error('getDonationsForPitch error:', error.message);
    return [];
  }
  return (data || []).map(rowToDonation);
}

// Reciprocal to getDonationsForPitch — every pitch a given user has
// backed, for their public profile's "Projects backed" section. Public
// page, so this only ever returns approved pitches: a donation record
// itself isn't sensitive, but a pitch that's since gone back to pending
// or been rejected shouldn't show up on someone's public profile.
export async function getBackedPitches(userId) {
  if (!userId) return [];
  const supabase = getSupabase();
  const { data: donationRows, error: donationError } = await supabase
    .from('pitch_donations')
    .select('pitch_id, created_at')
    .eq('donor_user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  if (donationError) {
    console.error('getBackedPitches (donations) error:', donationError.message);
    return [];
  }
  const pitchIds = [...new Set((donationRows || []).map((d) => d.pitch_id))];
  if (pitchIds.length === 0) return [];

  const { data: pitches, error: pitchError } = await supabase
    .from('pitches')
    .select('id, title, thumbnail, tag')
    .in('id', pitchIds)
    .eq('status', 'approved');
  if (pitchError) {
    console.error('getBackedPitches (pitches) error:', pitchError.message);
    return [];
  }
  // Preserve most-recently-backed-first order from the donation query
  // rather than whatever order .in() happens to return.
  const byId = Object.fromEntries(pitches.map((p) => [p.id, p]));
  return pitchIds.map((id) => byId[id]).filter(Boolean);
}

// Paid donations only (getDonationsForPitch defaults to completed).
export async function getTotalRaisedForPitch(pitchId) {
  const donations = await getDonationsForPitch(pitchId);
  return donations.reduce((sum, d) => sum + d.amountCents, 0);
}
