import { getSupabase } from './supabase';

// Excludes visually ambiguous characters (0/O, 1/I/L) since these codes
// get typed by hand — a code that's genuinely impossible to misread
// matters more here than a slightly larger character set.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(groups = 3, groupLength = 4) {
  const part = () => Array.from({ length: groupLength }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  return Array.from({ length: groups }, part).join('-');
}

// Checked at login (lib/accountContext.js) alongside comped access and
// Stripe. Fails closed on a lookup error — same posture as
// isCompedEmail — a database hiccup should never silently grant free
// access.
// Like hasActivePromoAccess, but returns the actual date (or null) for
// display on /account — "your access runs out on X" needs the real
// value, not just a yes/no.
export async function getPromoAccessExpiry(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('promo_access_expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('getPromoAccessExpiry error:', error.message);
    return null;
  }
  if (!data || !data.promo_access_expires_at) return null;
  return new Date(data.promo_access_expires_at) > new Date() ? data.promo_access_expires_at : null;
}

export async function hasActivePromoAccess(userId) {
  if (!userId) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('promo_access_expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('hasActivePromoAccess error:', error.message);
    return false;
  }
  return Boolean(data && data.promo_access_expires_at && new Date(data.promo_access_expires_at) > new Date());
}

// Generates `quantity` unique codes, each granting `durationDays` of
// access once redeemed. Retries on the astronomically unlikely event of
// a random collision with an existing code rather than trusting the
// random space is collision-free by assumption.
export async function generatePromoCodes({ quantity, durationDays, note, createdBy }) {
  const supabase = getSupabase();
  const created = [];

  for (let i = 0; i < quantity; i++) {
    let code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = randomCode();
      const { data: existing } = await supabase
        .from('promo_codes')
        .select('id')
        .ilike('code', candidate)
        .maybeSingle();
      if (!existing) code = candidate;
    }
    if (!code) throw new Error('Could not generate a unique code after several attempts — try again.');

    const { data, error } = await supabase
      .from('promo_codes')
      .insert({ code, duration_days: durationDays, note: note || null, created_by: createdBy || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    created.push(data);
  }

  return created;
}

export async function listPromoCodes() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listPromoCodes error:', error.message);
    return [];
  }
  return data;
}

// Plain admin bookkeeping toggle — has nothing to do with redemption, see
// migration 042 for why it's a separate column rather than derived from
// redeemed_by.
export async function setPromoCodeNoted(id, noted) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('promo_codes')
    .update({ noted: Boolean(noted) })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Code not found.');
  return data;
}

// Redeems a code for a signed-in user. Returns { ok: true, expiresAt } or
// { ok: false, error }. The .is('redeemed_by', null) guard on the update
// itself — not just the earlier read — is what actually prevents two
// simultaneous redemptions of the same code from both succeeding; if a
// race loses, zero rows come back from the update and this reports the
// code as already used rather than granting access twice over.
export async function redeemPromoCode({ code, userId, email }) {
  if (!code || !code.trim()) return { ok: false, error: 'Enter a code first.' };
  if (!userId) return { ok: false, error: 'Sign in to redeem a code.' };

  const supabase = getSupabase();
  const normalized = code.trim();

  const { data: found, error: findError } = await supabase
    .from('promo_codes')
    .select('id, duration_days, redeemed_by')
    .ilike('code', normalized)
    .maybeSingle();

  if (findError) {
    console.error('redeemPromoCode lookup error:', findError.message);
    return { ok: false, error: 'Something went wrong checking that code — try again.' };
  }
  if (!found) return { ok: false, error: 'That code doesn\u2019t exist. Double-check for typos.' };
  if (found.redeemed_by) return { ok: false, error: 'That code has already been used.' };

  const { data: updatedCode, error: updateError } = await supabase
    .from('promo_codes')
    .update({ redeemed_by: userId, redeemed_by_email: email || null, redeemed_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('redeemed_by', null)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error('redeemPromoCode update error:', updateError.message);
    return { ok: false, error: 'Something went wrong redeeming that code — try again.' };
  }
  if (!updatedCode) {
    // Someone else redeemed it in the moment between the read above and
    // this update — a genuine race, not an error.
    return { ok: false, error: 'That code has already been used.' };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('promo_access_expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  const now = new Date();
  const currentExpiry = profile && profile.promo_access_expires_at ? new Date(profile.promo_access_expires_at) : null;
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(base.getTime() + found.duration_days * 86400000);

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert({ user_id: userId, promo_access_expires_at: newExpiry.toISOString(), updated_at: now.toISOString() }, { onConflict: 'user_id' });

  if (upsertError) {
    console.error('redeemPromoCode profile upsert error:', upsertError.message);
    return { ok: false, error: 'The code was accepted but saving your access failed — contact support.' };
  }

  return { ok: true, expiresAt: newExpiry.toISOString(), durationDays: found.duration_days };
}
