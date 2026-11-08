import { getSupabase } from './supabase';
import { getLeavingIds } from './creatorStanding';
import { getFeaturedCreators, getNamedProfiles, getPublicProfilesByIds, looksLikeUserId } from './userProfiles';
import { linkedCreditAccounts } from './linkedCredits';
import { getUserRole } from './roles';
import { scheduledDue, DEFAULT_AD_SHARE_PERCENT } from './creatorShareRules';
import { DEFAULT_BONUS_CENTS, DEFAULT_PAYOUT_MINIMUM_CENTS, DEFAULT_REFERRAL_BONUS_MONTHS, DEFAULT_SHARE_CENTS, MAX_PICKS, normalizeLineup, shareCentsFor, splitLineup } from './artistSupportRules';

// Membership Artist Support, server side (migration 088: member_lineups +
// user_profiles.lineup_mode / share_visible + the site_settings amounts).
// This is the member's half of Creator Share: who they picked, how the
// share would split, and saving it. Nothing here moves money — the renewal
// webhook, the ledger and the payout batch are the next piece of work
// (mockups/creator-share-v2.html, section 7).
//
// Every read fails soft when the migration hasn't been run (available:
// false), so the page explains instead of crashing.

export class ArtistSupportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isMissingTable(error) {
  return Boolean(error) && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

function isMissingColumn(error) {
  return Boolean(error) && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || ''));
}

function centsTable(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  const out = {};
  for (const tier of Object.keys(fallback)) {
    const n = Number(raw[tier]);
    out[tier] = Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback[tier];
  }
  return out;
}

// The amounts, from site_settings (migration 088) with the proposed
// defaults until the columns exist. A change scheduled on
// /admin/creator-money (creator_share_next, migration 092) is applied
// here once its date has passed, so every reader — the renewal webhook,
// the payout batch, the Terms page — switches over at the same moment.
export async function getShareSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('site_settings')
    .select('creator_share_cents, referral_bonus_cents, creator_payout_minimum_cents')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    if (!isMissingColumn(error) && !isMissingTable(error)) console.error('getShareSettings error:', error.message);
    return { shareCents: DEFAULT_SHARE_CENTS, bonusCents: DEFAULT_BONUS_CENTS, payoutMinimumCents: DEFAULT_PAYOUT_MINIMUM_CENTS, referralBonusMonths: DEFAULT_REFERRAL_BONUS_MONTHS, adSharePercent: DEFAULT_AD_SHARE_PERCENT, scheduled: null, changedAt: null, migrated: false };
  }
  // The later columns (090: bonus months; 092: scheduled change; 103:
  // ad share), read on their own so a database without them keeps the
  // other settings.
  let extra = await supabase.from('site_settings').select('referral_bonus_months, creator_share_next, creator_share_changed_at, ad_share_percent').eq('id', 1).maybeSingle();
  if (extra.error) extra = await supabase.from('site_settings').select('referral_bonus_months, creator_share_next, creator_share_changed_at').eq('id', 1).maybeSingle();
  if (extra.error) extra = await supabase.from('site_settings').select('referral_bonus_months').eq('id', 1).maybeSingle();
  const more = extra.error ? {} : extra.data || {};
  const m = more.referral_bonus_months == null ? NaN : Number(more.referral_bonus_months);
  const adPct = (v, fallback) => (v != null && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Math.round(Number(v)) : fallback);
  let current = {
    shareCents: centsTable(data && data.creator_share_cents, DEFAULT_SHARE_CENTS),
    bonusCents: centsTable(data && data.referral_bonus_cents, DEFAULT_BONUS_CENTS),
    payoutMinimumCents: data && Number(data.creator_payout_minimum_cents) > 0 ? Number(data.creator_payout_minimum_cents) : DEFAULT_PAYOUT_MINIMUM_CENTS,
    referralBonusMonths: m >= 0 ? m : DEFAULT_REFERRAL_BONUS_MONTHS,
    adSharePercent: adPct(more.ad_share_percent, DEFAULT_AD_SHARE_PERCENT)
  };
  let scheduled = more.creator_share_next && more.creator_share_next.numbers ? more.creator_share_next : null;
  let changedAt = more.creator_share_changed_at || null;
  if (scheduledDue(scheduled)) {
    const n = scheduled.numbers;
    const patch = { creator_share_cents: n.shareCents, referral_bonus_cents: n.bonusCents, creator_payout_minimum_cents: n.payoutMinimumCents, referral_bonus_months: n.referralBonusMonths, creator_share_next: null, creator_share_changed_at: scheduled.effectiveAt };
    if (n.adSharePercent !== undefined && 'ad_share_percent' in more) patch.ad_share_percent = adPct(n.adSharePercent, current.adSharePercent);
    const applied = await supabase.from('site_settings').update(patch).eq('id', 1);
    if (applied.error) console.error('getShareSettings apply scheduled error:', applied.error.message);
    current = { shareCents: centsTable(n.shareCents, current.shareCents), bonusCents: centsTable(n.bonusCents, current.bonusCents), payoutMinimumCents: Number(n.payoutMinimumCents) || current.payoutMinimumCents, referralBonusMonths: Number(n.referralBonusMonths) >= 0 ? Number(n.referralBonusMonths) : current.referralBonusMonths, adSharePercent: adPct(n.adSharePercent, current.adSharePercent) };
    changedAt = scheduled.effectiveAt;
    scheduled = null;
  }
  return { ...current, scheduled, changedAt, migrated: true };
}

// Accounts with Creator Studio (the same roles slice 3b asks of a title's
// paid account: they need the Money page and payouts to collect) or the
// admin role. A role read is kept five minutes. Clerk's "no such account"
// (getUserRole's null) is no role; any other failure — a 5xx, a 429, the
// network — throws, so nobody is quietly left out of the list.
const CREATOR_STUDIO_ROLES = ['creator', 'content_scheduler', 'admin'];
const ROLE_TTL_MS = 5 * 60 * 1000;
const roleMemo = new Map();
async function roleFor(userId) {
  const hit = roleMemo.get(userId);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.role;
  const role = await getUserRole(userId);
  roleMemo.set(userId, { at: Date.now(), role });
  if (roleMemo.size > 2000) roleMemo.delete(roleMemo.keys().next().value);
  return role;
}

// The accounts a public title names as its Studio or Producer (decision
// 20; slice 6, lib/linkedCredits.js) that aren't in `already`, have
// Creator Studio or are admins, and have a display name — with the titles'
// names as their credits. A read that fails (the linked credits, a role,
// the profiles) throws: never a shorter list that would drop a member's
// pick from the month's share.
async function linkedProducers(already) {
  const accounts = await linkedCreditAccounts({ strict: true });
  const ids = [...accounts.keys()].filter((id) => !already.has(id));
  if (!ids.length) return [];
  const roles = await Promise.all(ids.map((id) => roleFor(id)));
  const allowed = ids.filter((id, i) => CREATOR_STUDIO_ROLES.includes(roles[i]));
  if (!allowed.length) return [];
  const profiles = await getNamedProfiles(allowed, { strict: true });
  return profiles.map((p) => {
    const entry = accounts.get(p.userId);
    return { ...p, credits: entry ? [...entry.titles] : [], mostRecent: entry ? entry.mostRecent : null };
  });
}

function toSupportable(c) {
  return {
    userId: c.userId,
    displayName: c.displayName,
    handle: c.handle || null,
    avatarUrl: c.avatarUrl || null,
    avatarPosition: c.avatarPosition || null,
    avatarZoom: c.avatarZoom || null,
    credits: (c.credits || []).slice(0, 4)
  };
}
const byName = (a, b) => a.displayName.localeCompare(b.displayName);

// The makers: anyone with a released title on the site (an approved
// episode they submitted or an approved series they own) and a display
// name — the same people the home page's "faces behind it" row draws
// from — who hasn't left (creator_standing.left_at, migration 091).
// Every money lane but members' picks reads this list: who can be a
// referrer (a ?via= link, a typed handle), the site-wide pool and a
// leaver's forfeit. A linked Studio or Producer is not a maker (slice 6
// left those lanes as they were). { strict } throws when a read fails —
// the catalogue or creator_standing (who left) — instead of answering a
// shorter list or one with a leaver in it: the invoice webhook (Stripe
// tries again), the payout batch's forfeit to the pool, a referral's check.
export async function listMakerCreators({ strict = false } = {}) {
  const [creators, leaving] = await Promise.all([getFeaturedCreators(5000, { strict }), getLeavingIds({ strict })]);
  return creators.filter((c) => !leaving.has(c.userId)).map(toSupportable).sort(byName);
}

// Who a member can pick in Artist Support: the makers above plus, since
// slice 6, an account a public title links as its Studio or Producer when
// it has Creator Studio or is an admin (decision 20). Pitch-only creators
// and location hosts are not in this list; creators who left drop out (no
// new picks). Members' picks are paid from this list (lib/creatorShare.js);
// nothing else is.
// A failed read of the linked producers throws — saving a lineup then
// answers "something went wrong" rather than refusing a real pick, and the
// invoice webhook fails so Stripe tries again. { lenient } is for what is
// only drawn (the search, a lineup's credits, a notice to creators): the
// makers alone when the linked read fails. { strict } also makes the
// makers' read throw (the invoice webhook).
export async function listSupportableCreators({ lenient = false, strict = false } = {}) {
  const [creators, leaving] = await Promise.all([getFeaturedCreators(5000, { strict }), getLeavingIds({ strict })]);
  let linked = [];
  try {
    linked = await linkedProducers(new Set(creators.map((c) => c.userId)));
  } catch (err) {
    if (!lenient) throw err;
    console.error('artistSupport linked producers:', err && err.message);
  }
  return [...creators, ...linked]
    .filter((c) => !leaving.has(c.userId))
    .map(toSupportable)
    .sort(byName);
}

export async function searchSupportableCreators(query, { excludeUserId, limit = 20 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const all = await listSupportableCreators({ lenient: true });
  const hits = all.filter((c) => {
    if (excludeUserId && c.userId === excludeUserId) return false;
    if (!q) return true;
    return (
      c.displayName.toLowerCase().includes(q) ||
      (c.handle && c.handle.toLowerCase().includes(q)) ||
      c.credits.some((t) => String(t).toLowerCase().includes(q))
    );
  });
  return { creators: hits.slice(0, limit), total: hits.length };
}

async function getPrefs(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('user_profiles').select('lineup_mode, share_visible').eq('user_id', userId).maybeSingle();
  if (error) {
    if (!isMissingColumn(error) && !isMissingTable(error)) console.error('artistSupport getPrefs error:', error.message);
    return { mode: 'equal', shareVisible: false, migrated: false };
  }
  return {
    mode: data && data.lineup_mode === 'custom' ? 'custom' : 'equal',
    shareVisible: Boolean(data && data.share_visible),
    migrated: true
  };
}

async function savePrefs(userId, { mode, shareVisible }) {
  const supabase = getSupabase();
  const patch = { lineup_mode: mode, share_visible: shareVisible };
  const updated = await supabase.from('user_profiles').update(patch).eq('user_id', userId).select('user_id');
  if (updated.error) throw new ArtistSupportError(`Could not save your preferences: ${updated.error.message}`, 500);
  if ((updated.data || []).length > 0) return;
  // No profile row yet (never visited the account page): make one.
  const inserted = await supabase.from('user_profiles').insert({ user_id: userId, ...patch });
  if (inserted.error && inserted.error.code !== '23505') throw new ArtistSupportError(`Could not save your preferences: ${inserted.error.message}`, 500);
}

// The member's lineup with everything the card needs to draw it.
export async function getLineup(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('member_lineups')
    .select('creator_id, weight, position, created_at')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { available: false, picks: [], mode: 'equal', shareVisible: false };
    throw new ArtistSupportError(`Could not load your creators: ${error.message}`, 500);
  }
  const rows = data || [];
  const [profiles, prefs, supportable] = await Promise.all([
    getPublicProfilesByIds(rows.map((r) => r.creator_id)),
    getPrefs(userId),
    listSupportableCreators({ lenient: true })
  ]);
  const credits = new Map(supportable.map((c) => [c.userId, c.credits]));
  const picks = rows.map((r, i) => {
    const p = profiles[r.creator_id] || {};
    return {
      creatorId: r.creator_id,
      weight: Number(r.weight) || 1,
      position: Number.isFinite(Number(r.position)) ? Number(r.position) : i,
      displayName: p.displayName || 'A creator',
      handle: p.handle || null,
      avatarUrl: p.avatarUrl || null,
      avatarPosition: p.avatarPosition || null,
      avatarZoom: p.avatarZoom || null,
      credits: credits.get(r.creator_id) || []
    };
  });
  return { available: true, picks, mode: prefs.mode, shareVisible: prefs.shareVisible };
}

// Replaces the whole lineup (the editor saves the list as it stands) and
// the two preferences. Validation: lib/artistSupportRules.js plus "must be
// a creator with released work" here; the database's trigger is the
// backstop for the cap.
export async function saveLineup(userId, raw) {
  const { lineup, errors } = normalizeLineup(raw, { selfId: userId });
  if (errors.length) throw new ArtistSupportError(errors[0]);
  for (const p of lineup.picks) {
    if (!looksLikeUserId(p.creatorId)) throw new ArtistSupportError('That creator could not be found.');
  }
  const supportable = new Set((await listSupportableCreators()).map((c) => c.userId));
  const unknown = lineup.picks.find((p) => !supportable.has(p.creatorId));
  if (unknown) throw new ArtistSupportError('Only creators with a released title on the site can be in your lineup.');

  const supabase = getSupabase();
  const cleared = await supabase.from('member_lineups').delete().eq('user_id', userId);
  if (cleared.error) {
    if (isMissingTable(cleared.error)) throw new ArtistSupportError('Artist Support is not switched on yet (migration 088 has not been run).', 503);
    throw new ArtistSupportError(`Could not save your creators: ${cleared.error.message}`, 500);
  }
  if (lineup.picks.length) {
    const rows = lineup.picks.slice(0, MAX_PICKS).map((p, i) => ({ user_id: userId, creator_id: p.creatorId, weight: p.weight, position: i }));
    const inserted = await supabase.from('member_lineups').insert(rows);
    if (inserted.error) throw new ArtistSupportError(`Could not save your creators: ${inserted.error.message}`, 500);
  }
  await savePrefs(userId, { mode: lineup.mode, shareVisible: lineup.shareVisible });
  return getLineup(userId);
}

// Everything the page and the app screen render, for one member.
export async function getArtistSupportPayload(userId, tier) {
  const [settings, lineup] = await Promise.all([getShareSettings(), getLineup(userId)]);
  const shareCents = shareCentsFor(settings.shareCents, tier);
  return {
    isSignedIn: true,
    tier: tier || 'basic',
    isPaid: shareCents > 0,
    shareCents,
    shareTable: settings.shareCents,
    maxPicks: MAX_PICKS,
    available: lineup.available,
    picks: lineup.picks,
    mode: lineup.mode,
    shareVisible: lineup.shareVisible,
    split: splitLineup(shareCents, lineup.picks, lineup.mode)
  };
}
