// The app's copy of the website's lib/tipRules.js (tips, fan support):
// the same presets, limits and fee maths, so the sheet shows the same
// numbers Checkout will charge. The server re-checks everything.
const STRIPE_FEE_PERCENT = 2.9;
const STRIPE_FEE_FIXED_CENTS = 30;

export const TIP_PRESETS_CENTS = [300, 500, 1000];
export const MIN_TIP_CENTS = 100;
export const DEFAULT_TIP_MAX_CENTS = 50000;
export const DEFAULT_TIP_CUT_PERCENT = 5;
export const MAX_NOTE_CHARS = 140;

export function feeCoverCents(amountCents) {
  const total = Math.ceil((amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT / 100));
  return Math.max(0, total - amountCents);
}

// What a tip of `amountCents` costs and where it goes.
export function tipQuote(amountCents, cutPercent = DEFAULT_TIP_CUT_PERCENT) {
  const cut = Number.isFinite(Number(cutPercent)) ? Number(cutPercent) : 0;
  const cutCents = Math.floor((amountCents * cut) / 100);
  const feeCents = feeCoverCents(amountCents);
  return { amountCents, creatorCents: amountCents - cutCents, cutCents, feeCents, totalCents: amountCents + feeCents, cutPercent: cut };
}

// "5", "5.00" or "$5" → cents; NaN when it isn't a number.
export function parseTipAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : NaN;
  const s = String(input || '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function validateTipInput({ amountCents, note, showName } = {}, { maxCents = DEFAULT_TIP_MAX_CENTS } = {}) {
  const amount = Number(amountCents);
  if (!Number.isInteger(amount)) return { ok: false, error: 'Enter a whole number of cents.' };
  if (amount < MIN_TIP_CENTS) return { ok: false, error: `The smallest tip is $${(MIN_TIP_CENTS / 100).toFixed(0)}.` };
  if (amount > maxCents) return { ok: false, error: `Tips go up to $${(maxCents / 100).toLocaleString('en-US')}.` };
  const cleanNote = note == null ? '' : String(note).replace(/\s+/g, ' ').trim();
  if (cleanNote.length > MAX_NOTE_CHARS) return { ok: false, error: `Keep the note to ${MAX_NOTE_CHARS} characters.` };
  return { ok: true, amountCents: amount, note: cleanNote || null, showName: Boolean(showName) };
}
