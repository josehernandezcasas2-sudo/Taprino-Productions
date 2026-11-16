// Crew pay through Stripe (migration 110) — the numbers the browser and
// the app need too (lib/crewPay.js pulls in Stripe and Supabase, so the
// shared bits live here).
//
// The deal (Jose, 2026-10-25): on a paid call the poster can secure the
// pay. They name the rate per person for the job, fund each booked
// person once they're booked, Studio Tapa holds it and releases it to
// the person's payout account when the poster confirms they worked.
// Studio Tapa's service fee and the card processing cover are added on
// top of the rate, so the person gets exactly the rate posted.
//
// Refund holds (Jose, 2026-11-16, migration 125): "Yes, hold the money for
// any disputes." A refund the poster asks for — the job didn't happen, it
// was cancelled, or they took the person off it — waits REFUND_WAIT_DAYS
// before the money goes back, so the crew member can say the job happened;
// a contested one waits for a full admin. The block between the two
// `shared` lines below is the app's mobile/src/lib/crewPayRules.js word for
// word (scripts/test-crew-pay.mjs checks); it imports nothing.
import { feeCoverCents } from './donationMath';

export const DEFAULT_CREW_PAY_CUT_PERCENT = 8;
export const MIN_CREW_PAY_CENTS = 2500;      // $25
export const MAX_CREW_PAY_CENTS = 2000000;   // $20,000 per person per job

export const CREW_PAY_STATUS = {
  pending_payment: 'Payment started',
  held: 'Held',
  disputed: 'Disputed', // the poster's bank is looking at the charge (migration 113)
  released: 'Paid out',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  failed: 'Failed'
};

// What the poster pays for one person at `amountCents`: the rate, the
// studio's fee (rounded down) and the card processing cover on the whole.
export function crewPayQuote(amountCents, cutPercent = DEFAULT_CREW_PAY_CUT_PERCENT) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const pct = Number.isFinite(Number(cutPercent)) ? Math.max(0, Number(cutPercent)) : DEFAULT_CREW_PAY_CUT_PERCENT;
  const cutCents = Math.floor((amount * pct) / 100);
  const feeCents = feeCoverCents(amount + cutCents);
  return { amountCents: amount, cutPercent: pct, cutCents, feeCents, totalCents: amount + cutCents + feeCents };
}

// shared:start — mobile/src/lib/crewPayRules.js is this block word for word.

export const payDollars = (cents) => `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: (cents || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// "Nov 19" on the site's calendar (Pacific, the clock the channels and
// the calls run on), so the server's notice, the page and the phone name
// the same day.
export function payDay(iso) {
  const t = iso instanceof Date ? iso.getTime() : Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const opts = { month: 'short', day: 'numeric' };
  try {
    return new Date(t).toLocaleDateString('en-US', { ...opts, timeZone: 'America/Los_Angeles' });
  } catch (err) {
    return new Date(t).toLocaleDateString('en-US', opts);
  }
}

export const REFUND_WAIT_DAYS = 3;
export const REFUND_KINDS = ['no_show', 'cancelled', 'unbooked'];
export const CONTEST_NOTE_MIN = 10;
export const CONTEST_NOTE_MAX = 1000;

const own = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '');

// When a refund asked at `from` goes back: REFUND_WAIT_DAYS later.
export function refundDueFrom(from) {
  const base = from instanceof Date ? from.getTime() : Date.parse(from || '');
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + REFUND_WAIT_DAYS * 86400000).toISOString();
}

// The poster's answer, as a chip.
const KIND_WORDS = { no_show: 'Didn’t happen', cancelled: 'Cancelled', unbooked: 'Taken off the job' };
export const refundKindWords = (kind) => own(KIND_WORDS, kind);

// The poster's answer, as the crew member reads it.
const SAYS = { no_show: 'the job didn’t happen', cancelled: 'the job was cancelled', unbooked: 'you’re off the job' };
export const refundSaysWords = (kind) => own(SAYS, kind);

const field = (p, camel, snake) => (p ? (p[camel] !== undefined ? p[camel] : p[snake]) : undefined);

// Where a held payment stands (a row from the database or a payment as the
// pages get it): none (no refund asked, or it was decided), waiting (the
// three days are running), contested (the crew member said the job
// happened: a full admin decides) or due (the three days are up; the
// daily step sends it back).
export function refundState(payment, now = new Date()) {
  if (!payment || field(payment, 'status', 'status') !== 'held') return 'none';
  const due = field(payment, 'refundDueAt', 'refund_due_at');
  if (!due || field(payment, 'contestDecision', 'contest_decision')) return 'none';
  if (field(payment, 'contestedAt', 'contested_at')) return 'contested';
  const t = Date.parse(due);
  return Number.isFinite(t) && t <= now.getTime() ? 'due' : 'waiting';
}

// The poster may still say "they worked it after all": a no-show or a
// cancellation whose money hasn't gone back yet, contested or not.
export function canChangeToWorked(payment, now = new Date()) {
  const kind = field(payment, 'refundKind', 'refund_kind');
  return refundState(payment, now) !== 'none' && (kind === 'no_show' || kind === 'cancelled');
}

export const CONTEST_PLACEHOLDER = 'What happened? The studio reads this.';
export const CONTEST_BUTTON = 'It happened — tell the studio';
export const WORKED_AFTER_ALL_BUTTON = 'They worked it after all';

// The crew member's box on the call.
export function workerRefundBox({ posterFirstName, kind, amountCents, dueAt, contestedAt }) {
  if (contestedAt) return `You told the studio on ${payDay(contestedAt)}. The ${payDollars(amountCents)} stays held until someone there decides; they may write to you both.`;
  return `${posterFirstName} says ${refundSaysWords(kind)}. The ${payDollars(amountCents)} goes back to them on ${payDay(dueAt)} unless you tell us otherwise.`;
}

// The poster's row: the chip, then the line under it. `amountCents` is what
// goes back to their card.
export function posterRefundChip(payment, now = new Date()) {
  const state = refundState(payment, now);
  if (state === 'contested') return 'Contested';
  if (state === 'waiting' || state === 'due') return `Refund ${payDay(field(payment, 'refundDueAt', 'refund_due_at'))}`;
  return '';
}
export function posterRefundLine({ workerFirstName, amountCents, dueAt, contested }) {
  if (contested) return `${workerFirstName} says the job happened. The ${payDollars(amountCents)} stays held until the studio decides.`;
  return `The ${payDollars(amountCents)} goes back to your card on ${payDay(dueAt)} unless ${workerFirstName} says otherwise.`;
}

// The working card's Get paid list: what follows "<$X> · <title>" on a
// payment whose refund was asked, or '' when none was.
export function cardRefundWords(payment, now = new Date()) {
  const state = refundState(payment, now);
  if (state === 'contested') return 'refund asked · you contested it';
  if (state === 'waiting' || state === 'due') return `refund asked, goes back ${payDay(field(payment, 'refundDueAt', 'refund_due_at'))}`;
  return '';
}

// shared:end

// What goes back to the poster: the whole charge when the job didn't
// happen, the charge less the card fee when it was cancelled or the person
// was taken off it (the amounts the refund made at once before migration 125).
export function refundAskedCents(kind, { totalCents, feeCents }) {
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  if (kind === 'no_show') return total;
  return Math.max(0, total - Math.max(0, Math.round(Number(feeCents) || 0)));
}

// Why the money went back (the refund's reason, in both refunded notices).
const REASONS = { no_show: 'the job didn’t happen', cancelled: 'the booking was cancelled', unbooked: 'they were taken off the job' };
export const refundReasonWords = (kind) => own(REASONS, kind) || 'the poster asked for it back';

// Before migration 125 a refund the poster asks for moves nothing.
export const REFUND_BEFORE_125_LINE = 'The secured pay stays held until the studio settles it.';
export const REFUND_MIGRATION_LINE = 'Answering a refund needs a database update (migration 125).';

// Can `userId` tell the studio the job happened? null = yes; else
// { status, code, error } with the line the person reads.
export function contestRefusal(payment, { userId, note = '', now = new Date() } = {}) {
  if (!payment || !userId || field(payment, 'workerId', 'worker_id') !== userId) {
    return { status: 403, code: 'not-yours', error: 'Only the crew member this pay was secured for can answer this.' };
  }
  if (field(payment, 'status', 'status') !== 'held') return { status: 409, code: 'not-held', error: 'This pay isn’t held any more.' };
  if (field(payment, 'contestDecision', 'contest_decision')) return { status: 409, code: 'decided', error: 'The studio has already decided this one.' };
  const state = refundState(payment, now);
  if (state === 'none') return { status: 409, code: 'no-refund', error: 'Nobody has asked for this pay back.' };
  if (state === 'contested') return { status: 409, code: 'contested', error: 'You’ve already told the studio. Someone there will decide.' };
  if (state === 'due') return { status: 409, code: 'due', error: 'The three days to answer are over, so the money is going back to the poster. Write to us if you think that’s wrong.' };
  const text = String(note == null ? '' : note).trim();
  if (text.length < CONTEST_NOTE_MIN) return { status: 400, code: 'note-short', error: `Say what happened, in a sentence or two (at least ${CONTEST_NOTE_MIN} characters).` };
  if (text.length > CONTEST_NOTE_MAX) return { status: 400, code: 'note-long', error: 'Keep it under 1,000 characters.' };
  return null;
}

// The notices (the bell, the push).
export function refundAskedNotice({ posterName, kind, title, amountCents, dueAt }) {
  return `${posterName} says ${refundSaysWords(kind)} on ${title}. The ${payDollars(amountCents)} secured for you goes back to them on ${payDay(dueAt)} unless you tell us otherwise.`;
}
export function contestedNotice({ workerName, title, amountCents }) {
  return `${workerName} says the job on ${title} happened. The ${payDollars(amountCents)} stays held until the studio decides — we may write to you both.`;
}
// side: 'worker' | 'poster'; decision: 'release' (to the crew member) | 'refund' (back to the poster).
export function refundDecidedNotice({ side, decision, title, amountCents }) {
  const money = payDollars(amountCents);
  if (side === 'worker') return `The studio looked at ${title}: the ${money} ${decision === 'release' ? 'is yours' : 'goes back to the poster'}.`;
  return `The studio looked at ${title}: the ${money} ${decision === 'release' ? 'goes to the crew member' : 'goes back to you'}.`;
}

// /admin/crew's line on a held payment whose refund was asked.
export function adminRefundLine(payment, now = new Date()) {
  const state = refundState(payment, now);
  if (state === 'none') return '';
  const kind = refundKindWords(field(payment, 'refundKind', 'refund_kind'));
  const base = `Refund asked by the poster · ${kind} · goes back ${payDay(field(payment, 'refundDueAt', 'refund_due_at'))}`;
  return state === 'contested' ? `${base} · Contested` : base;
}

// The release hold (security round 2, 2026-10-28; migration 114). A
// confirmed job pays out at once between people the site knows; between
// two accounts made last week, or on a worker's first payout through the
// site, it waits RELEASE_HOLD_DAYS first — long enough for a stolen
// card's owner to notice the charge, short enough not to matter on a
// real job. An age the site can't read counts as new.
export const RELEASE_HOLD_DAYS = 7;
export const ESTABLISHED_ACCOUNT_DAYS = 30;

export function releaseHoldDays({ posterAgeDays = null, workerAgeDays = null, workerPaidBefore = false } = {}) {
  const established = (age) => Number.isFinite(Number(age)) && Number(age) >= ESTABLISHED_ACCOUNT_DAYS;
  if (!established(posterAgeDays) || !established(workerAgeDays) || !workerPaidBefore) return RELEASE_HOLD_DAYS;
  return 0;
}

export function holdUntilFrom(from, days) {
  const base = from instanceof Date ? from.getTime() : Date.parse(from || '');
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + Math.max(0, days) * 86400000).toISOString();
}

// Is a hold still in force at `now`?
export function holdActive(holdUntil, now = new Date()) {
  const t = Date.parse(holdUntil || '');
  return Number.isFinite(t) && t > now.getTime();
}

// "releases Nov 4" for the chips (web + app).
export function holdLabel(holdUntil) {
  const t = Date.parse(holdUntil || '');
  if (!Number.isFinite(t)) return '';
  return `releases ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function crewPayRules() {
  return { defaultCutPercent: DEFAULT_CREW_PAY_CUT_PERCENT, minCents: MIN_CREW_PAY_CENTS, maxCents: MAX_CREW_PAY_CENTS, statuses: CREW_PAY_STATUS, releaseHoldDays: RELEASE_HOLD_DAYS, refundWaitDays: REFUND_WAIT_DAYS };
}
