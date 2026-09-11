import { getSupabase } from './supabase';

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
    status: row.status,
    createdAt: row.created_at
  };
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
export async function recordDonation({ pitchId, donorUserId, donorEmail, amountCents }) {
  if (!pitchId || !donorUserId) throw new Error('pitchId and donorUserId are required.');
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Enter a positive donation amount.');
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

export async function getDonationsForPitch(pitchId) {
  if (!pitchId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pitch_donations')
    .select('*')
    .eq('pitch_id', pitchId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getDonationsForPitch error:', error.message);
    return [];
  }
  return (data || []).map(rowToDonation);
}

// Sums every donation regardless of status for now, since nothing
// currently transitions a donation out of 'pending' (no real Stripe
// integration yet — see recordDonation's own note). Once real charges
// exist, this should filter to status='completed' only, so a pending or
// failed charge never inflates the total shown to donors/creators.
export async function getTotalRaisedForPitch(pitchId) {
  const donations = await getDonationsForPitch(pitchId);
  return donations.reduce((sum, d) => sum + d.amountCents, 0);
}
