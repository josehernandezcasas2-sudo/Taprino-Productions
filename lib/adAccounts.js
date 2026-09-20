import { getSupabase } from './supabase';
import { uploadHouseAdVideo } from './houseAdUpload';
import { notifyAdvertiserAdReviewed } from './notify';

function rowToAdAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    companyName: row.company_name,
    contactEmail: row.contact_email,
    status: row.status,
    creditBalanceCents: row.credit_balance_cents,
    createdAt: row.created_at
  };
}

// One account per signed-in user — self-service, not gated by any Clerk
// role. See migration 056 for why this is deliberately kept separate
// from the admin/creator/sub_admin role system.
export async function getOwnAdAccount(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('ad_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('getOwnAdAccount error:', error.message);
    return null;
  }
  return data ? rowToAdAccount(data) : null;
}

export async function createAdAccount({ userId, companyName, contactEmail }) {
  if (!userId) throw new Error('userId is required.');
  if (!companyName || !companyName.trim()) throw new Error('A company name is required.');
  if (!contactEmail || !contactEmail.trim()) throw new Error('A contact email is required.');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('ad_accounts')
    .insert({ user_id: userId, company_name: companyName.trim(), contact_email: contactEmail.trim() })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique_violation on user_id — the pre-check in the API route
    // handles the common case, but this is the real backstop against the
    // same race every other "one per user" flow in this app guards
    // against the same way (see e.g. lib/userProfiles.js).
    if (error.code === '23505') {
      throw new Error('You already have an ad account.');
    }
    throw new Error(error.message);
  }
  return rowToAdAccount(data);
}

// Lets an advertiser edit their own account's company name/contact
// email after creation — the profile page at /advertise/account is the
// only caller. Scoped by user_id in the query itself (not just assumed
// from the caller) so this can never touch a different advertiser's
// account even if a wrong id somehow made it this far.
export async function updateAdAccount({ userId, companyName, contactEmail }) {
  if (!userId) throw new Error('userId is required.');
  const updates = {};
  if (companyName !== undefined) {
    if (!companyName.trim()) throw new Error('Company name cannot be empty.');
    updates.company_name = companyName.trim();
  }
  if (contactEmail !== undefined) {
    if (!contactEmail.trim()) throw new Error('Contact email cannot be empty.');
    updates.contact_email = contactEmail.trim();
  }
  if (Object.keys(updates).length === 0) throw new Error('Nothing to update.');

  const supabase = getSupabase();
  const { data, error } = await supabase.from('ad_accounts').update(updates).eq('user_id', userId).select('*').single();
  if (error) throw new Error(error.message);
  return rowToAdAccount(data);
}

function rowToAd(row) {
  return {
    id: row.id,
    title: row.title,
    videoUrl: row.video_url,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    clickUrl: row.click_url,
    active: row.active,
    reviewStatus: row.review_status,
    impressions: row.impressions,
    clicks: row.clicks,
    budgetTotalCents: row.budget_total_cents,
    budgetSpentCents: row.budget_spent_cents,
    costPerImpressionCents: row.cost_per_impression_cents,
    targeting: row.targeting,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    pausedByAdvertiser: row.paused_by_advertiser
  };
}

// Every ad submitted this way starts pending review and — importantly —
// starts with cost_per_impression_cents left unset (null). That's
// deliberate, not an oversight: an advertiser choosing their own ad's
// budget CAP is fine (it's their money on the line), but letting them
// also set the RATE their own budget gets billed at would be letting
// them set their own price. Admin sets that rate during review; until
// then the ad simply can't accumulate spend even if it were somehow
// live, since increment_house_ad_impression() coalesces a null rate to
// zero cost per impression.
export async function submitAdvertiserAd({ adAccountId, title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents, targeting }) {
  if (!adAccountId) throw new Error('adAccountId is required.');
  if (!title || !title.trim()) throw new Error('A title is required.');
  if (!videoBase64) throw new Error('An ad video is required.');
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    // No server-side video duration detection exists anywhere in this
    // codebase — admin's own house ad form requires the same manual
    // entry, since VAST's <Duration> tag has to exactly match the real
    // file or playback misbehaves. A wrong guess here is worse than
    // asking the advertiser to just look at their own file's length.
    throw new Error('Please enter the ad\'s exact duration in seconds — VAST playback requires this to match the actual video file.');
  }
  if (budgetTotalCents != null && (!Number.isFinite(budgetTotalCents) || budgetTotalCents <= 0)) {
    throw new Error('Budget must be a positive amount.');
  }

  // The same upload path admin's own house ad form already uses — see
  // lib/houseAdUpload.js for why this deliberately skips Cloudflare
  // Stream (no piracy concern for a promo clip, VAST wants a direct
  // progressive file, and this keeps the whole system self-contained).
  const { url: videoUrl } = await uploadHouseAdVideo({ base64: videoBase64, fileName: videoFileName });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .insert({
      title: title.trim(),
      video_url: videoUrl,
      duration_seconds: durationSeconds,
      click_url: clickUrl || null,
      ad_account_id: adAccountId,
      review_status: 'pending',
      active: true,
      budget_total_cents: budgetTotalCents || null,
      targeting: targeting || null
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToAd(data);
}

// Every ad belonging to one advertiser account — their own dashboard's
// list, regardless of review status, so a rejected or still-pending ad
// is visible to them too, not just approved/live ones.
// Only a still-pending ad can be withdrawn — once admin has made a
// decision (approved or rejected), that decision is the record; an
// advertiser changing their mind about something already reviewed
// would need a different flow, not this one. review_status is checked
// directly in the query rather than fetched-then-checked in JS, so
// there's no window where a decision could land between the check and
// the update.
export async function withdrawPendingAd({ adId, adAccountId }) {
  if (!adId || !adAccountId) throw new Error('adId and adAccountId are required.');
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .update({ review_status: 'withdrawn' })
    .eq('id', adId)
    .eq('ad_account_id', adAccountId)
    .eq('review_status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That ad isn\'t pending review, so it can\'t be withdrawn.');
}

// Same reasoning as withdraw — only while still pending, since admin
// may already be partway through reviewing the current version, and
// letting an approved ad's creative or targeting change without going
// back through review would defeat the point of review entirely.
export async function editPendingAd({ adId, adAccountId, title, videoBase64, videoFileName, durationSeconds, clickUrl, budgetTotalCents }) {
  if (!adId || !adAccountId) throw new Error('adId and adAccountId are required.');
  if (budgetTotalCents != null && (!Number.isFinite(budgetTotalCents) || budgetTotalCents <= 0)) {
    throw new Error('Budget must be a positive amount.');
  }

  const updates = {};
  if (title !== undefined) {
    if (!title.trim()) throw new Error('A title is required.');
    updates.title = title.trim();
  }
  if (durationSeconds != null) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Duration must be a positive number of seconds.');
    }
    updates.duration_seconds = durationSeconds;
  }
  if (clickUrl !== undefined) updates.click_url = clickUrl || null;
  if (budgetTotalCents !== undefined) updates.budget_total_cents = budgetTotalCents || null;
  if (videoBase64) {
    const { url } = await uploadHouseAdVideo({ base64: videoBase64, fileName: videoFileName });
    updates.video_url = url;
  }
  if (Object.keys(updates).length === 0) throw new Error('Nothing to update.');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .update(updates)
    .eq('id', adId)
    .eq('ad_account_id', adAccountId)
    .eq('review_status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That ad isn\'t pending review, so it can\'t be edited.');
  return rowToAd(data);
}

// Advertiser-initiated pause/resume on their own already-approved ad.
// paused_by_advertiser is the whole point of this function existing
// separately from just flipping active directly — it's what lets
// add_ad_credits() (migration 062) tell "the advertiser stopped this on
// purpose" apart from "this ran out of money," so a credits top-up
// never silently un-pauses something they deliberately turned off.
// Resuming only succeeds if the ad hasn't separately been stopped by the
// system (its own cap reached, or the account's shared credits at zero)
// — the advertiser can un-pause their own choice, but resuming past a
// real spending limit still requires actually adding credits or raising
// the cap, not just clicking resume.
export async function setAdPaused({ adId, adAccountId, paused }) {
  if (!adId || !adAccountId) throw new Error('adId and adAccountId are required.');

  const supabase = getSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from('house_ads')
    .select('id, review_status, budget_total_cents, budget_spent_cents, ad_account_id')
    .eq('id', adId)
    .eq('ad_account_id', adAccountId)
    .eq('review_status', 'approved')
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error('Ad not found, or not yet approved.');

  const updates = { paused_by_advertiser: !!paused };
  if (paused) {
    updates.active = false;
  } else {
    if (existing.budget_total_cents != null && existing.budget_spent_cents >= existing.budget_total_cents) {
      throw new Error('This ad has already reached its own spending cap — raise the cap to resume it.');
    }
    const { data: account, error: accountError } = await supabase
      .from('ad_accounts')
      .select('credit_balance_cents')
      .eq('id', existing.ad_account_id)
      .single();
    if (accountError) throw new Error(accountError.message);
    if (account.credit_balance_cents <= 0) {
      throw new Error('Your account is out of ad credits — add more to resume this ad.');
    }
    updates.active = true;
  }

  const { data, error } = await supabase.from('house_ads').update(updates).eq('id', adId).select('*').single();
  if (error) throw new Error(error.message);
  return rowToAd(data);
}

export async function getAdsForAccount(adAccountId) {
  if (!adAccountId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getAdsForAccount error:', error.message);
    return [];
  }
  return (data || []).map(rowToAd);
}

// Admin's review queue — joined with the submitting account's own info
// (company name, contact email) via Supabase's nested-select syntax,
// since house_ads.ad_account_id is a real foreign key to ad_accounts.id.
// Only ever advertiser-submitted rows have anything to review here —
// admin's own house ads default to review_status='approved' at creation
// and never pass through this queue at all.
export async function getPendingAds() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .select('*, ad_accounts(company_name, contact_email)')
    .eq('review_status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('getPendingAds error:', error.message);
    return [];
  }
  return (data || []).map((row) => ({
    ...rowToAd(row),
    accountCompanyName: row.ad_accounts ? row.ad_accounts.company_name : null,
    accountContactEmail: row.ad_accounts ? row.ad_accounts.contact_email : null
  }));
}

// One combined action rather than separate "edit" and "approve" calls —
// admin reviewing a submitted ad often wants to fix something (a typo in
// the title, swap a low-quality video, set the actual billing rate) as
// part of the same decision, not as two round trips. Any of the edit
// fields can be omitted to leave that value as the advertiser submitted
// it; decision is required.
export async function reviewAdvertiserAd({ adId, decision, adminEmail, title, videoBase64, videoFileName, durationSeconds, clickUrl, costPerImpressionCents, rejectionReason }) {
  if (!adId) throw new Error('adId is required.');
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('decision must be approved or rejected.');
  }
  // The whole point of this field — an advertiser told just "Rejected"
  // with nothing else has no way to know what to fix before
  // resubmitting, so a reason is mandatory here, not optional.
  if (decision === 'rejected' && (!rejectionReason || !rejectionReason.trim())) {
    throw new Error('A rejection reason is required — the advertiser needs to know what to fix.');
  }

  const updates = {
    review_status: decision,
    reviewed_by: adminEmail || null,
    reviewed_at: new Date().toISOString(),
    rejection_reason: decision === 'rejected' ? rejectionReason.trim() : null
  };
  if (title && title.trim()) updates.title = title.trim();
  if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    updates.duration_seconds = durationSeconds;
  }
  if (clickUrl !== undefined) updates.click_url = clickUrl || null;
  if (costPerImpressionCents != null && Number.isFinite(costPerImpressionCents) && costPerImpressionCents >= 0) {
    updates.cost_per_impression_cents = costPerImpressionCents;
  }
  if (videoBase64) {
    const { url } = await uploadHouseAdVideo({ base64: videoBase64, fileName: videoFileName });
    updates.video_url = url;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('house_ads')
    .update(updates)
    .eq('id', adId)
    .select('*, ad_accounts(contact_email)')
    .single();
  if (error) throw new Error(error.message);

  // Best-effort, same as every other notification in this codebase — a
  // failed or skipped email must never surface as a failure of the
  // actual approve/reject action, which has already succeeded by now.
  const contactEmail = data.ad_accounts ? data.ad_accounts.contact_email : null;
  notifyAdvertiserAdReviewed({
    to: contactEmail,
    adTitle: data.title,
    decision,
    rejectionReason: data.rejection_reason
  }).catch((err) => console.error('notifyAdvertiserAdReviewed error:', err.message));

  return rowToAd(data);
}

// Called only from the Stripe webhook (pages/api/webhook.js) once a
// credits purchase actually completes — additionalCents comes straight
// from the Stripe payment amount there, never a client-supplied value.
// The ownership check already happened earlier, when the checkout
// session was created for this specific adAccountId in the first place
// (see pages/api/ads/buy-credits.js) — by the time a webhook fires, this
// is just applying a payment that's already been made.
//
// The actual balance update and any resulting ad reactivation both live
// in the add_ad_credits() database function (migration 061) rather than
// here, so the "top up, then resume anything that paused purely from
// running dry" logic happens as one atomic operation instead of two
// separate round trips that could race against a simultaneous impression.
export async function addAdCredits({ adAccountId, additionalCents }) {
  if (!adAccountId) throw new Error('adAccountId is required.');
  if (!Number.isFinite(additionalCents) || additionalCents <= 0) {
    throw new Error('Credits amount must be a positive number of cents.');
  }

  const supabase = getSupabase();
  const { error } = await supabase.rpc('add_ad_credits', {
    target_account_id: adAccountId,
    amount_cents: Math.round(additionalCents)
  });
  if (error) throw new Error(error.message);
}
