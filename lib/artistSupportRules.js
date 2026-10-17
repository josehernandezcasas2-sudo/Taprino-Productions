// Membership Artist Support (Creator Share, mockups/creator-share-v1/v2 and
// the playable creator-share-play.html; tables in migration 088). The
// client-safe rules the website page, the app screen and the server all
// share: a member points the share of their paid membership at up to 10
// creators ("their lineup"); equal shares unless they set their own
// (weights 1–5); cents that don't divide go to the first picks so the
// parts always add up exactly. Mirror: mobile/src/lib/artistSupportRules.js.
//
// What this does NOT do yet: move money. The split is shown to the member
// and saved; the renewal webhook, ledger and payouts come later.

export const MAX_PICKS = 10;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;
export const LINEUP_MODES = ['equal', 'custom'];

// Proposed defaults (Jose decides the real numbers); the live values are
// site_settings.creator_share_cents / referral_bonus_cents (migration 088).
export const DEFAULT_SHARE_CENTS = { standard: 200, premium: 400, sponsor: 200 };
export const DEFAULT_BONUS_CENTS = { standard: 100, premium: 200, sponsor: 100 };

export function shareCentsFor(shareCents, tier) {
  const table = shareCents && typeof shareCents === 'object' ? shareCents : DEFAULT_SHARE_CENTS;
  const n = Number(table[tier]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function dollars(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export function clampWeight(weight) {
  const n = Math.round(Number(weight));
  if (!Number.isFinite(n)) return MIN_WEIGHT;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, n));
}

// Splits `cents` across entries [{ id, weight }] in proportion to weight.
// Leftover cents go to the first entries, one each, in order — the first
// pick is never short and the parts always sum to the whole.
export function splitByWeight(cents, entries) {
  const total = Math.max(0, Math.round(Number(cents) || 0));
  const list = (entries || []).map((e) => ({ id: e.id, weight: Math.max(0, Number(e.weight) || 0) }));
  const W = list.reduce((s, e) => s + e.weight, 0);
  if (!list.length || !W || !total) return list.map((e) => ({ id: e.id, cents: 0, percent: W ? Math.round((e.weight / W) * 1000) / 10 : 0 }));
  const out = list.map((e) => ({ id: e.id, cents: Math.floor((total * e.weight) / W), percent: Math.round((e.weight / W) * 1000) / 10 }));
  let left = total - out.reduce((s, o) => s + o.cents, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length) {
    out[i].cents += 1;
    left -= 1;
  }
  return out;
}

// The lineup as the member sees it: every pick counts as 1 unless the
// member turned on "set my own shares" (mode 'custom').
export function splitLineup(cents, picks, mode) {
  const custom = mode === 'custom';
  return splitByWeight(cents, (picks || []).map((p) => ({ id: p.creatorId, weight: custom ? clampWeight(p.weight) : 1 })));
}

// Validates what the client sends: { picks: [{ creatorId, weight }], mode,
// shareVisible }. Duplicates are dropped, weights clamped, yourself
// refused, and more than MAX_PICKS is an error (not silently trimmed, so
// a stale client can't lose someone's tenth pick without noticing).
export function normalizeLineup(raw, { selfId } = {}) {
  const errors = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  const mode = LINEUP_MODES.includes(src.mode) ? src.mode : 'equal';
  const shareVisible = Boolean(src.shareVisible);
  const seen = new Set();
  const picks = [];
  for (const p of Array.isArray(src.picks) ? src.picks : []) {
    const id = p && typeof p.creatorId === 'string' ? p.creatorId.trim() : '';
    if (!id || seen.has(id)) continue;
    if (selfId && id === selfId) {
      errors.push("You can't pick yourself.");
      continue;
    }
    seen.add(id);
    picks.push({ creatorId: id, weight: clampWeight(p.weight) });
  }
  if (picks.length > MAX_PICKS) errors.push(`A lineup holds at most ${MAX_PICKS} creators.`);
  return { lineup: { picks, mode, shareVisible }, errors };
}

// Copy for the three ways a renewal can be split (the default rule when
// the lineup is empty: what the member watched, else the site-wide pool).
export const BASIS_LABELS = {
  picks: 'your picks',
  watched: 'followed your watching',
  pool: 'the site-wide pool',
  none: 'nothing to split'
};
