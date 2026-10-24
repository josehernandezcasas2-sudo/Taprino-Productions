import { getSupabase } from './supabase';
import { getPayoutSummary } from './creatorPayouts';
import { getCreatorMoney } from './creatorShareBatch';
import { getReferralStats } from './creatorShare';
import { getOwnListings } from './locations';
import { getPitchesForCreator } from './pitches';
import { getPublicIdentities } from './userProfiles';
import { buildHistory, laneTotals, owedCents, paidInYearCents, rangeFor, inRange, isPeriod, isYear, periodOf, periodsBetween, periodLabel, toCsv } from './creatorMoneyRules';

// SERVER-ONLY. The creator's Money page (/creator/money, the app's
// Account → Money; mockup signed off 2026-10-23): every lane that pays a
// creator, read from the tables that already hold it. Nothing here moves
// money. One call gathers: Creator Share ledger lines and payouts
// (member support), title sales (purchases), backing (pitch_donations for
// the creator's pitches), bookings (location_requests where they host),
// the referral numbers, and the Express account's live balance (the same
// three Stripe calls the Payouts card makes). lib/creatorMoneyRules.js
// turns the rows into History lines and totals.

const isMissingTable = (error) => Boolean(error && /could not find the table|relation .* does not exist|PGRST205/i.test(error.message || ''));
const rows = (res) => (res && !res.error ? res.data || [] : []);
const n = (v) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);

export async function getCreatorMoneyPage(userId, { period = null } = {}) {
  const sb = getSupabase();
  const key = isPeriod(period) || isYear(period) ? period : periodOf();
  const range = rangeFor(key);

  const [ledgerRes, purchasesRes, payoutsRes, bookingsRes, pitches, listings, money, referrals, identities] = await Promise.all([
    sb.from('creator_ledger').select('id, kind, cents, basis, member_id, payment_id, payout_id, note, created_at').eq('creator_id', userId).eq('lane', 'earnings').order('created_at', { ascending: false }).limit(2000),
    sb.from('purchases').select('*').eq('creator_id', userId).in('status', ['completed', 'refunded']).order('completed_at', { ascending: false }).limit(2000),
    sb.from('creator_payouts').select('*').eq('creator_id', userId).order('created_at', { ascending: false }).limit(200),
    sb.from('location_requests').select('*').eq('host_id', userId).in('status', ['paid', 'done', 'refunded']).order('paid_at', { ascending: false }).limit(1000),
    getPitchesForCreator(userId).catch(() => []),
    getOwnListings(userId).catch(() => []),
    getCreatorMoney(userId).catch((err) => { console.error('creatorMoney getCreatorMoney:', err.message); return null; }),
    getReferralStats(userId).catch((err) => { console.error('creatorMoney getReferralStats:', err.message); return null; }),
    getPublicIdentities([userId]).catch(() => ({}))
  ]);
  for (const res of [ledgerRes, purchasesRes, payoutsRes, bookingsRes]) {
    if (res.error && !isMissingTable(res.error)) console.error('creatorMoney read error:', res.error.message);
  }
  const ledger = rows(ledgerRes);
  const purchases = rows(purchasesRes);
  const payouts = rows(payoutsRes);
  const bookings = rows(bookingsRes);

  const pitchIds = (pitches || []).map((p) => p.id);
  const donationsRes = pitchIds.length
    ? await sb.from('pitch_donations').select('*').in('pitch_id', pitchIds).in('status', ['completed', 'refunded', 'disputed']).order('created_at', { ascending: false }).limit(2000)
    : { data: [] };
  const donations = rows(donationsRes);

  // Who may be named: members only where they chose to share their name;
  // backers and producers by display name, as the pitch dashboard and the
  // request page already show them; buyers never.
  const memberIds = [...new Set(ledger.map((l) => l.member_id).filter(Boolean))];
  const otherIds = [...new Set([...donations.map((d) => d.donor_user_id), ...bookings.map((b) => b.producer_id)].filter(Boolean))];
  const [profilesRes, others] = await Promise.all([
    memberIds.length ? sb.from('user_profiles').select('user_id, display_name, share_visible').in('user_id', memberIds) : Promise.resolve({ data: [] }),
    otherIds.length ? getPublicIdentities(otherIds).catch(() => ({})) : Promise.resolve({})
  ]);
  const memberNames = {};
  for (const p of rows(profilesRes)) if (p.share_visible && p.display_name) memberNames[p.user_id] = p.display_name;
  const names = {};
  for (const [id, who] of Object.entries(others)) if (who && who.displayName) names[id] = who.displayName;

  const pitchTitles = Object.fromEntries((pitches || []).map((p) => [p.id, p.title]));
  const locationTitles = Object.fromEntries((listings || []).map((l) => [l.id, l.title]));
  const missingLocations = [...new Set(bookings.map((b) => b.location_id).filter((id) => id && !locationTitles[id]))];
  if (missingLocations.length) {
    const extra = await sb.from('locations').select('id, title').in('id', missingLocations);
    for (const l of rows(extra)) locationTitles[l.id] = l.title;
  }

  const lines = buildHistory({ ledger, purchases, donations, bookings, payouts, names, memberNames, pitchTitles, locationTitles });
  const inPeriod = lines.filter((l) => inRange(l.at, range));
  const totals = laneTotals(lines, range);
  const earliest = lines.length ? lines[lines.length - 1].at : null;
  const year = key.slice(0, 4);

  // The lanes' own cards.
  const unpaidInPeriod = ledger.filter((l) => l.payout_id == null && l.kind !== 'payout' && inRange(l.created_at, range)).reduce((s, l) => s + n(l.cents), 0);
  const owed = Math.max(0, owedCents(ledger));
  const memberSupport = {
    monthCents: totals.member_support,
    shareCents: totals.memberShare,
    referralCents: totals.referral,
    carriedCents: Math.max(0, owed - Math.max(0, unpaidInPeriod)),
    owedCents: owed
  };

  const soldInPeriod = purchases.filter((p) => inRange(p.completed_at, range));
  const byTitle = {};
  for (const p of soldInPeriod) {
    const k = `${p.target_type}:${p.target_id}`;
    byTitle[k] = byTitle[k] || { key: k, title: p.title || 'A title', type: p.target_type, sold: 0, cents: 0 };
    byTitle[k].sold += 1;
    byTitle[k].cents += n(p.creator_cents);
  }
  const sales = {
    monthCents: totals.sales,
    sold: soldInPeriod.length,
    refunds: purchases.filter((p) => p.status === 'refunded' && inRange(p.refunded_at, range)).length,
    refundCents: purchases.filter((p) => p.status === 'refunded' && inRange(p.refunded_at, range)).reduce((s, p) => s + n(p.creator_cents), 0),
    allTimeCents: purchases.filter((p) => p.status === 'completed').reduce((s, p) => s + n(p.creator_cents), 0),
    titles: Object.values(byTitle).sort((a, b) => b.cents - a.cents).slice(0, 4)
  };

  const byPitch = {};
  for (const d of donations) {
    const e = byPitch[d.pitch_id] || (byPitch[d.pitch_id] = { id: d.pitch_id, title: pitchTitles[d.pitch_id] || 'A pitch', backers: 0, raisedCents: 0, cutCents: 0, yoursCents: 0, allRaisedCents: 0, donors: new Set() });
    if (d.status === 'completed') e.allRaisedCents += n(d.amount_cents);
    if (d.status !== 'refunded' && inRange(d.completed_at || d.created_at, range)) {
      e.backers += 1;
      e.donors.add(d.donor_user_id);
      e.raisedCents += n(d.amount_cents);
      e.cutCents += n(d.platform_cut_cents);
      e.yoursCents += n(d.creator_payout_cents);
    }
  }
  const goalFor = (id) => {
    const p = (pitches || []).find((x) => x.id === id);
    const g = p && p.funding_goal != null ? Number(p.funding_goal) : null;
    return g && Number.isFinite(g) ? Math.round(g * 100) : null;
  };
  const backing = {
    monthCents: totals.backing,
    pitches: Object.values(byPitch)
      .map((e) => ({ id: e.id, title: e.title, backers: e.donors.size, raisedCents: e.raisedCents, cutCents: e.cutCents, yoursCents: e.yoursCents, allRaisedCents: e.allRaisedCents, goalCents: goalFor(e.id), href: `/pitches/${e.id}` }))
      .sort((a, b) => b.yoursCents - a.yoursCents)
      .slice(0, 4),
    backersAllTime: new Set(donations.filter((d) => d.status === 'completed').map((d) => d.donor_user_id).filter(Boolean)).size
  };

  const byPlace = {};
  for (const b of bookings) {
    if (!inRange(b.paid_at, range)) continue;
    const e = byPlace[b.location_id] || (byPlace[b.location_id] = { id: b.location_id, title: locationTitles[b.location_id] || 'A place', shoots: 0, bookingCents: 0, cutCents: 0, yoursCents: 0 });
    e.shoots += 1;
    e.bookingCents += n(b.subtotal_cents) + n(b.cleaning_cents);
    e.cutCents += n(b.platform_cut_cents);
    e.yoursCents += n(b.host_payout_cents);
  }
  const today = todayIso();
  const upcoming = bookings.filter((b) => b.status === 'paid' && b.starts_on >= today).sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))[0] || null;
  const bookingLane = {
    shows: (listings || []).length > 0 || bookings.length > 0,
    monthCents: totals.bookings,
    places: Object.values(byPlace).sort((a, b) => b.yoursCents - a.yoursCents).slice(0, 4),
    nextShoot: upcoming ? { id: upcoming.id, title: locationTitles[upcoming.location_id] || 'A place', startsOn: upcoming.starts_on, href: `/locations/requests/${upcoming.id}` } : null
  };

  // Stripe's live view of the Express account (null until it's ready).
  let summary = null;
  let summaryError = null;
  try {
    summary = await getPayoutSummary(userId);
  } catch (err) {
    console.error('creatorMoney getPayoutSummary:', err.message);
    summaryError = 'Stripe could not be reached just now.';
  }

  const buyersAllTime = new Set(purchases.filter((p) => p.status === 'completed').map((p) => p.buyer_id).filter(Boolean)).size;
  const me = identities[userId] || null;

  return {
    available: true,
    period: key,
    periodLabel: periodLabel(key),
    periods: periodsBetween(earliest),
    year,
    creator: { displayName: me ? me.displayName : null },
    payouts: {
      state: money ? money.payoutState : 'off',
      bank: summary ? summary.bank : null,
      availableCents: summary ? summary.availableCents : null,
      pendingCents: summary ? summary.pendingCents : null,
      nextBankPayout: summary ? summary.nextPayout : null,
      summaryError
    },
    top: {
      monthCents: totals.total,
      owedCents: owed,
      nextPayout: money ? money.nextPayout : null,
      minimumCents: money ? money.minimumCents : null,
      paidYearCents: paidInYearCents(lines, year)
    },
    lanes: { member_support: memberSupport, sales, backing, bookings: bookingLane },
    link: referrals && referrals.available !== false ? referrals : null,
    supporters: {
      picked: money ? money.pickedBy : 0,
      watching: money ? money.supporters.watching : 0,
      backers: backing.backersAllTime,
      buyers: buyersAllTime,
      names: money ? money.supporters.names : []
    },
    history: inPeriod.slice(0, 500),
    historyTotal: inPeriod.length,
    laneCounts: totals.count
  };
}

// The CSV for the chosen month or year: one row per History line.
export async function getCreatorMoneyCsv(userId, { period = null } = {}) {
  const page = await getCreatorMoneyPage(userId, { period });
  return { filename: `studio-tapa-money-${page.period}.csv`, csv: toCsv(page.history) };
}
