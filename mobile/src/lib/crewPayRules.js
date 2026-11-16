// Secured crew pay: the words and small rules the app needs, from the
// website's lib/crewPayRules.js. Everything from the "shared:start" line to
// the "shared:end" line is that file's block word for word —
// scripts/test-crew-pay.mjs checks it; change both together. Pure, imports
// nothing.

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
