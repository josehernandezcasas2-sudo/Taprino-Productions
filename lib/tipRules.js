// Tips (fan support lane), pure and client-safe. The maths is the same as
// backing: the fan covers the card fee on top of the tip so the creator
// keeps more (Jose, 2026-10-24), the studio keeps a cut of the tip
// itself. Tested by `node scripts/test-tips.mjs`; the app mirrors it in
// mobile/src/lib/tipRules.js. The fee maths repeats lib/donationMath.js
// (2.9% + 30¢ covered on top) so this file stays import-free and the
// test can run it directly.
const STRIPE_FEE_PERCENT = 2.9;
const STRIPE_FEE_FIXED_CENTS = 30;

export function feeCoverCents(amountCents) {
  const total = Math.ceil((amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT / 100));
  return Math.max(0, total - amountCents);
}

function splitDonation(amountCents, cutPercent) {
  const cut = Number.isFinite(Number(cutPercent)) ? Number(cutPercent) : 0;
  const platformCutCents = Math.floor((amountCents * cut) / 100);
  const fee = feeCoverCents(amountCents);
  return { amountCents, platformCutCents, creatorPayoutCents: amountCents - platformCutCents, feeCoverCents: fee, totalChargedCents: amountCents + fee };
}

// $3 / $5 / $10 sit where fans actually tip (Ko-fi's default coffee is $3,
// Patreon pledges average $5-7, YouTube's Super Thanks presets are
// $2/$5/$10/$50); the ceiling is $100 (Jose, 2026-10-24), editable on
// /admin/settings along with the 5% cut.
export const TIP_PRESETS_CENTS = [300, 500, 1000];
export const MIN_TIP_CENTS = 100;
export const DEFAULT_TIP_MAX_CENTS = 10000;
export const DEFAULT_TIP_CUT_PERCENT = 5;
export const MAX_NOTE_CHARS = 140;
export const TIP_EMAIL_GAP_HOURS = 24;

// What a tip of `amountCents` costs and where it goes.
export function tipQuote(amountCents, cutPercent = DEFAULT_TIP_CUT_PERCENT) {
  const split = splitDonation(amountCents, cutPercent);
  return {
    amountCents: split.amountCents,
    creatorCents: split.creatorPayoutCents,
    cutCents: split.platformCutCents,
    feeCents: split.feeCoverCents,
    totalCents: split.totalChargedCents,
    cutPercent: Number(cutPercent) || 0
  };
}

// Whole dollars typed as "5", "5.00" or "$5" → cents; NaN when it isn't
// a number.
export function parseTipAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : NaN;
  const s = String(input || '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

// { ok, error, amountCents, note, showName } — the route and the sheet
// check the same rules.
export function validateTipInput({ amountCents, note, showName } = {}, { maxCents = DEFAULT_TIP_MAX_CENTS } = {}) {
  const amount = Number(amountCents);
  if (!Number.isInteger(amount)) return { ok: false, error: 'Enter a whole number of cents.' };
  if (amount < MIN_TIP_CENTS) return { ok: false, error: `The smallest tip is $${(MIN_TIP_CENTS / 100).toFixed(0)}.` };
  if (amount > maxCents) return { ok: false, error: `Tips go up to $${(maxCents / 100).toLocaleString('en-US')}.` };
  const cleanNote = note == null ? '' : String(note).replace(/\s+/g, ' ').trim();
  if (cleanNote.length > MAX_NOTE_CHARS) return { ok: false, error: `Keep the note to ${MAX_NOTE_CHARS} characters.` };
  return { ok: true, amountCents: amount, note: cleanNote || null, showName: Boolean(showName) };
}

// Email the creator about this tip only when the same fan hasn't had one
// sent in the last TIP_EMAIL_GAP_HOURS. `lastEmailedAt` is the newest
// emailed_at from that tipper to that creator, or null.
export function tipEmailDue(lastEmailedAt, now = new Date()) {
  if (!lastEmailedAt) return true;
  const last = new Date(lastEmailedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= TIP_EMAIL_GAP_HOURS * 60 * 60 * 1000;
}

// Who the creator sees: the fan's name only when they chose to show it.
export function tipperLabel(tip, displayName) {
  return tip && tip.show_name && displayName ? displayName : 'A fan';
}

// A return path we'll send Checkout back to: same-site, no scheme games.
export function safeTipReturn(path, fallback = '/') {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\s<>"']/.test(path)) return fallback;
  return path.split('#')[0].slice(0, 300);
}

// ?tipped=<id> on the way back; the banner reads the state from it.
export function tippedState(query) {
  const v = query && query.tipped;
  if (!v) return null;
  if (v === 'cancelled') return 'cancelled';
  return 'done';
}
