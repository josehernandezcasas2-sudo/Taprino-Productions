import { getSupabase } from './supabase';

// Same alphabet as promoCodes.js — excludes visually ambiguous characters
// (0/O, 1/I/L) since these get typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(groups = 3, groupLength = 4) {
  const part = () => Array.from({ length: groupLength }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  return Array.from({ length: groups }, part).join('-');
}

// Generates `quantity` unique codes, each worth `amountCents` in ad
// credits once redeemed. Same collision-retry approach as
// generatePromoCodes — retries on the astronomically unlikely event of
// a random collision rather than trusting the random space is
// collision-free by assumption.
export async function generateAdCreditCodes({ quantity, amountCents, note, createdBy }) {
  const supabase = getSupabase();
  const created = [];

  for (let i = 0; i < quantity; i++) {
    let code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = randomCode();
      const { data: existing } = await supabase
        .from('ad_credit_codes')
        .select('id')
        .ilike('code', candidate)
        .maybeSingle();
      if (!existing) code = candidate;
    }
    if (!code) throw new Error('Could not generate a unique code after several attempts — try again.');

    const { data, error } = await supabase
      .from('ad_credit_codes')
      .insert({ code, amount_cents: amountCents, note: note || null, created_by: createdBy || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    created.push(data);
  }

  return created;
}

export async function listAdCreditCodes() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('ad_credit_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listAdCreditCodes error:', error.message);
    return [];
  }
  return data;
}

// Plain admin bookkeeping toggle, same as promo_codes.noted — no effect
// on redemption.
export async function setAdCreditCodeNoted(id, noted) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('ad_credit_codes')
    .update({ noted: Boolean(noted) })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Code not found.');
  return data;
}

// Redeems a code into a specific ad account's shared credit balance.
// Same race-condition guard as redeemPromoCode: the .is('redeemed_by_account_id',
// null) on the update itself — not just the earlier read — is what
// actually prevents two simultaneous redemptions of the same code from
// both succeeding.
//
// The actual balance increment (and resuming any ad that had paused
// purely from running dry) is delegated to the add_ad_credits() database
// function already built for real Stripe purchases (migration 061/062) —
// a code redemption should behave identically to buying credits from the
// advertiser's own point of view, so it goes through the exact same path
// rather than a parallel one that could drift out of sync.
export async function redeemAdCreditCode({ code, adAccountId, email }) {
  if (!code || !code.trim()) return { ok: false, error: 'Enter a code first.' };
  if (!adAccountId) return { ok: false, error: 'Create an ad account first.' };

  const supabase = getSupabase();
  const normalized = code.trim();

  const { data: found, error: findError } = await supabase
    .from('ad_credit_codes')
    .select('id, amount_cents, redeemed_by_account_id')
    .ilike('code', normalized)
    .maybeSingle();

  if (findError) {
    console.error('redeemAdCreditCode lookup error:', findError.message);
    return { ok: false, error: 'Something went wrong checking that code — try again.' };
  }
  if (!found) return { ok: false, error: 'That code doesn\u2019t exist. Double-check for typos.' };
  if (found.redeemed_by_account_id) return { ok: false, error: 'That code has already been used.' };

  const { data: updatedCode, error: updateError } = await supabase
    .from('ad_credit_codes')
    .update({ redeemed_by_account_id: adAccountId, redeemed_by_email: email || null, redeemed_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('redeemed_by_account_id', null)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error('redeemAdCreditCode update error:', updateError.message);
    return { ok: false, error: 'Something went wrong redeeming that code — try again.' };
  }
  if (!updatedCode) {
    // Someone else redeemed it in the moment between the read above and
    // this update — a genuine race, not an error.
    return { ok: false, error: 'That code has already been used.' };
  }

  const { error: creditError } = await supabase.rpc('add_ad_credits', {
    target_account_id: adAccountId,
    amount_cents: found.amount_cents
  });
  if (creditError) {
    console.error('redeemAdCreditCode add_ad_credits error:', creditError.message);
    return { ok: false, error: 'The code was accepted but crediting your account failed — contact support.' };
  }

  return { ok: true, amountCents: found.amount_cents };
}
