import { getSupabase } from './supabase';
import { uploadHouseAdVideo } from './houseAdUpload';

function rowToAdAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    companyName: row.company_name,
    contactEmail: row.contact_email,
    status: row.status,
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
    reviewedAt: row.reviewed_at
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
