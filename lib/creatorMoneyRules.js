// The creator's Money page: pure, client-safe maths. Takes the rows the
// server fetched (ledger lines, sales, backings, bookings, payouts) and
// turns them into one History (every line in one list, each in exactly
// one lane), the month's lane totals, and the four numbers at the top.
// Tested by `node scripts/test-creator-money.mjs`; the app mirrors the
// labels only (it renders what /api/creator/money sends).
//
// Lanes (Jose, 2026-10-23): member support (Creator Share: member share +
// referral bonus, paid by transfer on the 1st), ad share (the creators'
// percent of the ads that played inside their titles, credited on the
// 1st for the month before and paid in the same transfer; 2026-10-24,
// migration 103), tips (fan support, added 2026-10-24), title sales (Buy
// to own), backing (Pitch Room), bookings (Locations, hosts only), and
// payouts (the transfers themselves).

export const LANES = {
  member_support: { label: 'Member support', short: 'Member support' },
  ad_share: { label: 'Ad share', short: 'Ads' },
  tips: { label: 'Tips', short: 'Tips' },
  sales: { label: 'Title sales', short: 'Sales' },
  backing: { label: 'Backing', short: 'Backing' },
  bookings: { label: 'Bookings', short: 'Bookings' },
  payouts: { label: 'Payouts', short: 'Payouts' }
};
export const LANE_ORDER = ['member_support', 'ad_share', 'tips', 'sales', 'backing', 'bookings', 'payouts'];
// The lanes the monthly transfer pays (everything else lands in the
// creator's Stripe balance at the sale).
export const TRANSFER_LANES = ['member_support', 'ad_share'];

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM' of a date, in UTC like the rest of Creator Share.
export function periodOf(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function isPeriod(key) {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

export function isYear(key) {
  return typeof key === 'string' && /^\d{4}$/.test(key);
}

// { start, end } as ISO strings, end exclusive.
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)).toISOString(), end: new Date(Date.UTC(y, m, 1)).toISOString() };
}

export function yearRange(year) {
  const y = Number(year);
  return { start: new Date(Date.UTC(y, 0, 1)).toISOString(), end: new Date(Date.UTC(y + 1, 0, 1)).toISOString() };
}

export function rangeFor(key) {
  if (isYear(key)) return yearRange(key);
  return monthRange(isPeriod(key) ? key : periodOf());
}

export function inRange(iso, range) {
  return Boolean(iso) && iso >= range.start && iso < range.end;
}

export function periodLabel(key) {
  if (isYear(key)) return key;
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// The months a creator can switch between: from their earliest line to
// now, newest first, at most `max`.
export function periodsBetween(earliestIso, now = new Date(), max = 24) {
  const out = [];
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const first = earliestIso ? new Date(earliestIso) : cur;
  const stop = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  while (cur >= stop && out.length < max) {
    out.push(periodOf(cur));
    cur.setUTCMonth(cur.getUTCMonth() - 1);
  }
  if (!out.length) out.push(periodOf(now));
  return out;
}

const n = (v) => Number(v) || 0;
const nameOr = (names, id, fallback) => (id && names && names[id] ? names[id] : fallback);
const shortDates = (a, b) => {
  const f = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
  return !b || a === b ? f(a) : `${f(a)} – ${f(b)}`;
};

// Every line the page lists. Each row source becomes one or two lines
// (the money coming in, and a refund / chargeback / reversal taking it
// back), newest first. Two name maps, kept apart on purpose: `names` for
// the people the site already shows by display name (backers,
// producers), `memberNames` only for members who chose to share their
// name in Artist Support. A member who also backed a pitch is still
// "A member" on their membership lines. Buyers are never named. Tippers
// (`tipperNames`) only where they ticked "Show my name"; the rest are
// "A fan". A tip line carries `tipId`, `note` and `noteHidden` so the
// page can offer Hide / Show note.
export function buildHistory({ ledger = [], purchases = [], donations = [], bookings = [], payouts = [], tips = [], names = {}, memberNames = {}, tipperNames = {}, pitchTitles = {}, locationTitles = {} } = {}) {
  const lines = [];

  for (const t of tips) {
    if (!['completed', 'refunded', 'disputed'].includes(t.status)) continue;
    const who = t.show_name ? nameOr(tipperNames, t.tipper_id, 'A fan') : 'A fan';
    const note = t.note || null;
    const hidden = Boolean(t.note_hidden);
    const detail = note ? (hidden ? 'note hidden by you' : `“${note}”`) : 'no note';
    const yours = n(t.creator_payout_cents);
    lines.push({ id: `tip:${t.id}`, at: t.completed_at || t.created_at, lane: 'tips', kind: 'tip', label: who, detail, where: 'Stripe balance', cents: yours, source: t.stripe_payment_intent_id || t.id, tipId: t.id, amountCents: n(t.amount_cents), note, noteHidden: hidden });
    if (t.status === 'refunded') {
      lines.push({ id: `tip-refund:${t.id}`, at: t.refunded_at || t.completed_at || t.created_at, lane: 'tips', kind: 'refund', label: who, detail: t.refund_reason ? `Refunded by the studio · ${t.refund_reason}` : 'Refunded by the studio', where: 'Taken back from your balance', cents: -yours, source: t.stripe_payment_intent_id || t.id });
    }
    if (t.status === 'disputed' || (t.dispute_status && n(t.clawback_cents) > 0)) {
      const back = n(t.clawback_cents) || yours;
      const state = t.dispute_status === 'won' ? 'won · paid back' : t.dispute_status === 'lost' ? 'lost' : 'waiting on the bank';
      lines.push({ id: `tip-dispute:${t.id}`, at: t.disputed_at || t.completed_at || t.created_at, lane: 'tips', kind: 'chargeback', label: who, detail: `disputed the ${dollars(n(t.amount_cents))} tip · ${state}`, where: 'Taken back until it is decided', cents: -back, source: t.stripe_payment_intent_id || t.id });
      if (n(t.returned_cents) > 0) {
        lines.push({ id: `tip-returned:${t.id}`, at: t.dispute_closed_at || t.returned_at || t.disputed_at || t.created_at, lane: 'tips', kind: 'returned', label: who, detail: 'Dispute won · your share paid back', where: 'Stripe balance', cents: n(t.returned_cents), source: t.stripe_payment_intent_id || t.id });
      }
    }
  }

  for (const l of ledger) {
    if (l.kind === 'payout') continue; // creator_payouts rows carry these, with their status
    const cents = n(l.cents);
    const at = l.created_at;
    const where = l.payout_id ? 'Paid out' : 'Owed · pays on the 1st';
    if (l.kind === 'member_share') {
      const who = nameOr(memberNames, l.member_id, 'A member');
      const how = l.basis === 'picks' ? 'picked you' : l.basis === 'pool' ? 'site-wide share' : 'by watching';
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'member_share', label: 'Member share', detail: `${who} · ${how}`, where, cents, source: l.payment_id || l.id });
    } else if (l.kind === 'referral') {
      const who = nameOr(memberNames, l.member_id, 'A member you brought');
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'referral', label: 'Referral bonus', detail: `${who} renewed`, where, cents, source: l.payment_id || l.id });
    } else if (l.kind === 'reversal') {
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'reversal', label: 'Reversed', detail: l.note || 'A membership payment was refunded or disputed', where: 'Taken back', cents, source: l.id });
    } else if (l.kind === 'adjustment') {
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'adjustment', label: cents < 0 ? 'Credit cancelled' : 'Adjustment', detail: l.note || '', where: cents < 0 ? 'Taken back' : where, cents, source: l.id });
    } else if (l.kind === 'forfeit') {
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'forfeit', label: 'Moved to the creator pool', detail: l.note || 'Not collected in time', where: 'Gone to the pool', cents, source: l.id });
    } else if (l.kind === 'pool_share') {
      lines.push({ id: `ledger:${l.id}`, at, lane: 'member_support', kind: 'pool_share', label: 'Creator pool share', detail: l.note || 'Split by views', where, cents, source: l.id });
    } else if (l.kind === 'ad_share') {
      // "Night Shift · 1,240 ads · October 2026": the title is the label.
      const parts = String(l.note || '').split(' · ');
      const title = parts.length > 1 ? parts[0] : 'Ad share';
      const detail = parts.length > 1 ? parts.slice(1).join(' · ') : (l.note || '');
      lines.push({ id: `ledger:${l.id}`, at, lane: 'ad_share', kind: 'ad_share', label: title, detail, where, cents, source: l.id, episodeId: l.episode_id || null, units: l.units == null ? null : n(l.units), href: l.episode_id ? `/episode/${l.episode_id}` : undefined });
    }
  }

  for (const p of purchases) {
    if (!['completed', 'refunded'].includes(p.status)) continue;
    const title = p.title || 'A title';
    const what = p.target_type === 'series' ? `${title} · whole series` : title;
    const price = n(p.paid_cents || p.price_cents);
    lines.push({ id: `sale:${p.id}`, at: p.completed_at || p.created_at, lane: 'sales', kind: 'sale', label: what, detail: `${dollars(price)} · a buyer`, where: 'Stripe balance', cents: n(p.creator_cents), source: p.stripe_payment_intent_id || p.id, href: p.target_type === 'series' ? `/series/${p.target_id}` : `/episode/${p.target_id}` });
    if (p.status === 'refunded') {
      lines.push({ id: `sale-refund:${p.id}`, at: p.refunded_at || p.completed_at || p.created_at, lane: 'sales', kind: 'refund', label: what, detail: p.refund_kind === 'self' ? 'Buyer refunded within the refund window' : p.refund_kind === 'takedown' ? 'Refunded after a takedown' : 'Refunded', where: 'Taken back from your balance', cents: -n(p.creator_cents), source: p.stripe_payment_intent_id || p.id });
    }
  }

  for (const d of donations) {
    if (!['completed', 'refunded', 'disputed'].includes(d.status)) continue;
    const title = pitchTitles[d.pitch_id] || 'A pitch';
    const who = nameOr(names, d.donor_user_id, 'A backer');
    lines.push({ id: `backing:${d.id}`, at: d.completed_at || d.created_at, lane: 'backing', kind: 'backing', label: title, detail: `${who} backed ${dollars(n(d.amount_cents))}`, where: 'Stripe balance', cents: n(d.creator_payout_cents), source: d.stripe_charge_id || d.id, href: `/pitches/${d.pitch_id}` });
    if (d.status === 'refunded') {
      lines.push({ id: `backing-refund:${d.id}`, at: d.refunded_at || d.completed_at || d.created_at, lane: 'backing', kind: 'refund', label: title, detail: d.refund_reason ? `Refunded · ${d.refund_reason}` : 'Refunded by the studio', where: 'Taken back from your balance', cents: -n(d.creator_payout_cents), source: d.stripe_charge_id || d.id });
    }
    if (d.status === 'disputed' || (d.dispute_status && n(d.clawback_cents) > 0)) {
      const back = n(d.clawback_cents) || n(d.creator_payout_cents);
      const state = d.dispute_status === 'won' ? 'won · paid back' : d.dispute_status === 'lost' ? 'lost' : 'waiting on the bank';
      lines.push({ id: `backing-dispute:${d.id}`, at: d.disputed_at || d.completed_at || d.created_at, lane: 'backing', kind: 'chargeback', label: title, detail: `${who} disputed ${dollars(n(d.amount_cents))} · ${state}`, where: 'Taken back until it is decided', cents: -back, source: d.stripe_charge_id || d.id });
      if (n(d.returned_cents) > 0) {
        lines.push({ id: `backing-returned:${d.id}`, at: d.dispute_closed_at || d.updated_at || d.disputed_at || d.created_at, lane: 'backing', kind: 'returned', label: title, detail: 'Dispute won · your share paid back', where: 'Stripe balance', cents: n(d.returned_cents), source: d.stripe_charge_id || d.id });
      }
    }
  }

  for (const b of bookings) {
    if (!['paid', 'done', 'refunded'].includes(b.status)) continue;
    const title = locationTitles[b.location_id] || 'A place';
    const who = nameOr(names, b.producer_id, 'A producer');
    const days = shortDates(b.starts_on, b.ends_on);
    const hostCents = n(b.host_payout_cents);
    lines.push({ id: `booking:${b.id}`, at: b.paid_at || b.created_at, lane: 'bookings', kind: 'booking', label: title, detail: `${who} · ${days}${b.project_title ? ` · ${b.project_title}` : ''}`, where: 'Stripe balance', cents: hostCents, source: b.stripe_payment_intent_id || b.id, href: `/locations/requests/${b.id}` });
    if (b.status === 'refunded' && n(b.refund_cents) > 0) {
      // Stripe reverses the host's transfer in the same proportion as the
      // refund to the producer (reverse_transfer on a partial refund).
      const total = n(b.total_charged_cents);
      const back = total > 0 ? Math.round(n(b.refund_cents) * hostCents / total) : hostCents;
      lines.push({ id: `booking-refund:${b.id}`, at: b.refunded_at || b.paid_at || b.created_at, lane: 'bookings', kind: 'refund', label: title, detail: b.refund_reason ? `Refunded · ${b.refund_reason}` : 'Refunded under the cancellation policy', where: 'Taken back from your balance', cents: -back, source: b.stripe_payment_intent_id || b.id });
    }
    if (n(b.clawback_cents) > 0) {
      const state = b.dispute_status === 'won' ? 'won · paid back' : b.dispute_status === 'lost' ? 'lost' : 'waiting on the bank';
      lines.push({ id: `booking-dispute:${b.id}`, at: b.disputed_at || b.paid_at || b.created_at, lane: 'bookings', kind: 'chargeback', label: title, detail: `${who} disputed the payment · ${state}`, where: 'Taken back until it is decided', cents: -n(b.clawback_cents), source: b.stripe_payment_intent_id || b.id });
      if (n(b.returned_cents) > 0) {
        lines.push({ id: `booking-returned:${b.id}`, at: b.updated_at || b.disputed_at || b.created_at, lane: 'bookings', kind: 'returned', label: title, detail: 'Dispute won · your share paid back', where: 'Stripe balance', cents: n(b.returned_cents), source: b.stripe_payment_intent_id || b.id });
      }
    }
  }

  for (const p of payouts) {
    const cents = n(p.cents);
    const reversed = n(p.reversed_cents);
    const status = reversed >= cents && cents > 0 ? 'reversed' : reversed > 0 ? 'partly_reversed' : p.status;
    const where = status === 'paid' ? 'Moved to your Stripe balance' : status === 'pending' ? 'Sending' : status === 'failed' ? 'Failed · will retry' : status === 'reversed' ? 'Returned to the studio' : 'Partly returned';
    lines.push({ id: `payout:${p.id}`, at: p.paid_at || p.created_at, lane: 'payouts', kind: 'payout', label: 'Creator Share payout', detail: `${periodLabel(p.period)}${p.stripe_transfer_id ? ` · transfer ${p.stripe_transfer_id}` : ''}`, where, cents, status, source: p.stripe_transfer_id || p.id });
    if (reversed > 0) {
      lines.push({ id: `payout-reversed:${p.id}`, at: p.reversed_at || p.paid_at || p.created_at, lane: 'payouts', kind: 'reversal', label: 'Payout returned', detail: `${periodLabel(p.period)} · the transfer was reversed`, where: 'Owed again', cents: -reversed, source: p.stripe_transfer_id || p.id });
    }
  }

  return lines.filter((l) => l.at).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// What each lane added up to inside a range. Payout lines are the money
// moving, not new money, so they never count toward a total.
export function laneTotals(lines, range) {
  const out = { member_support: 0, ad_share: 0, tips: 0, sales: 0, backing: 0, bookings: 0, payouts: 0, total: 0, memberShare: 0, referral: 0, adUnits: 0, refunds: 0, count: {} };
  for (const l of lines) {
    if (!inRange(l.at, range)) continue;
    out[l.lane] = (out[l.lane] || 0) + l.cents;
    out.count[l.lane] = (out.count[l.lane] || 0) + 1;
    if (l.lane !== 'payouts') out.total += l.cents;
    if (l.kind === 'member_share') out.memberShare += l.cents;
    if (l.kind === 'referral') out.referral += l.cents;
    if (l.kind === 'ad_share') out.adUnits += n(l.units);
    if (['refund', 'chargeback', 'reversal'].includes(l.kind) && l.lane !== 'payouts') out.refunds += l.cents;
  }
  return out;
}

// Credits still unpaid: every earnings line with no payout yet. `pick`
// narrows it to one lane's kinds ('ad_share', or everything else).
export function owedCents(ledger, pick = null) {
  const keep = (l) => (pick === 'ad_share' ? l.kind === 'ad_share' : pick === 'member_support' ? l.kind !== 'ad_share' : true);
  return ledger.filter((l) => l.payout_id == null && l.kind !== 'payout' && keep(l)).reduce((s, l) => s + n(l.cents), 0);
}

// "Paid to you this year": the transfers that went through (less what
// came back) plus the card money that reached the Stripe account in
// the other lanes, net of refunds and chargebacks.
export function paidInYearCents(lines, year) {
  const range = yearRange(year);
  let sum = 0;
  for (const l of lines) {
    if (!inRange(l.at, range)) continue;
    if (l.lane === 'payouts') {
      if (l.kind === 'payout' && (l.status === 'paid' || l.status === 'partly_reversed' || l.status === 'reversed')) sum += l.cents;
      if (l.kind === 'reversal') sum += l.cents;
    } else if (!TRANSFER_LANES.includes(l.lane)) {
      sum += l.cents;
    }
  }
  return Math.max(0, sum);
}

export function dollars(cents) {
  const v = (Number(cents) || 0) / 100;
  const s = Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return v < 0 ? `−${s}` : s;
}

// Signed, for the Yours column: +$3.57 / −$2.26 / $22.80 for a payout.
export function signed(cents, lane) {
  if (lane === 'payouts' && cents > 0) return dollars(cents);
  return cents > 0 ? `+${dollars(cents)}` : dollars(cents);
}

// One row per line, for the creator's accountant.
export function toCsv(lines) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['date', 'lane', 'kind', 'what', 'detail', 'where', 'yours_usd', 'source'];
  const rows = lines.map((l) => [l.at ? l.at.slice(0, 10) : '', LANES[l.lane] ? LANES[l.lane].label : l.lane, l.kind, l.label, l.detail, l.where, ((l.cents || 0) / 100).toFixed(2), l.source || ''].map(esc).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}
