// Removals held a month, and titles brought back (Jose, 2026-11-15:
// "withdrawn titles can come back whenever possible but need to have a
// certain requirement, we only hold the data up to a month if there is no
// purchase. If it goes to just streaming, or just the tv, then yes, it can
// be withdrawn completely, unless otherwise mentioned that we can store the
// data for later use"; the agreement is mockups/round3-build-contract.md,
// section A; migration 124's columns). Pure and client-safe: it imports
// nothing, so a page, the app and a script take their words and rules from
// here and scripts/test-removal.mjs runs every one in plain Node.
//
//   - a confirmed removal of something nobody bought comes off the site at
//     once and its files are kept HOLD_DAYS (purge_after), then deleted for
//     good by the daily clean-up — unless the owner asked to keep them for
//     later (keep_after_removal) — and anything bought is kept for its
//     buyers for good (confirmOutcome);
//   - a removed title is still on file until then, and comes back when its
//     owner asks (restore_requested_at, restore_reason) and someone on the
//     team approves it; one the team removed only through a full admin
//     (askBackFor, restoreRefusal);
//   - the words every surface uses for those states (removedState,
//     REMOVAL_WORDS, CONFIRM_LABEL).
//
// A row may be a database row (snake_case) or a creator route's row
// (camelCase: /api/creator/my-submissions, the show payload): every rule
// reads either. Before migration 124 a row has no purge_after column:
// has124() is false, a removal is deleted at once as before, and nothing
// can be asked back (MIGRATION_124_LINE).
//
// The app's mobile/src/lib/removalRules.js is this file word for word
// (scripts/test-removal.mjs checks it).

export const HOLD_DAYS = 30;
export const RESTORE_REASON_MAX = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// How an admin-started removal's reason is stored (lib/showAdmin.js
// removeShow, lib/titleRemoval.js), and how a take-down's rejection reason
// starts (lib/moderation.js decide): a removal the team made, not the
// owner's request.
export const ADMIN_REMOVAL_PREFIX = 'Removed by an admin: ';
export const TAKEN_DOWN_PREFIX = 'Taken down after review: ';

export const MIGRATION_124_LINE = 'Bringing titles back needs a database update (migration 124).';

export const REMOVAL_WORDS = {
  keepLabel: 'Keep the files so I can bring it back later',
  holdNote: 'It comes off the site once we confirm. We keep the files for 30 days so you can change your mind, then delete them — unless you tick the box.',
  boughtNote: 'It comes off the site once we confirm. People who bought it keep it, so we keep it for them.',
  askBack: 'Ask to bring it back',
  askBackMenu: 'Ask to bring it back…',
  askBackHelp: 'Someone on the team looks at it and puts it back as it was. Selling stays off until you price it again.',
  askBackReason: 'Anything we should know? (optional)',
  askBackSend: 'Send the request',
  askBackSent: 'Asked. We let you know once someone on the team has looked at it.',
  cancelAsk: 'Take back the request',
  waitingBack: 'Waiting on us to bring it back',
  askedLine: 'You asked to bring it back. Someone on the team looks at it soon.',
  teamOnly: 'The team removed this, so only a full admin can bring it back.',
  teamCancel: 'The team started this removal, so only the team can take it back.',
  withShow: 'It came off with its show: ask to bring the show back instead.',
  keptForBuyers: 'Removed · kept for buyers',
  keptForLater: 'Removed · kept for later',
  deleteNow: 'Delete now…',
  deleteNowHelp: 'Deletes it for good right away, files and all — for abuse or a legal reason. Never on anything someone bought.',
  deleteNowReason: 'Why (kept in the audit log; the owner reads it)',
  boughtNoDelete: 'Someone bought it, so it can’t be deleted. Confirming the removal keeps it for its buyers.',
  queueKind: 'Bring back',
  approve: 'Bring it back',
  deny: 'Deny…',
  denyConfirm: 'Confirm the denial',
  denyPlaceholder: 'A note for the owner (they read this)'
};

// The deletion queue's Confirm button, by what confirming does.
export const CONFIRM_LABEL = {
  hold: 'Remove · keep 30 days',
  buyers: 'Remove · kept for buyers',
  later: 'Remove · kept for later',
  delete: 'Confirm delete'
};

const hasOwn = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

function pick(row, camel, snake) {
  if (!row || typeof row !== 'object') return undefined;
  if (hasOwn(row, camel) && row[camel] !== undefined) return row[camel];
  return row[snake];
}

// Whether the database has migration 124, read off a row: a database row
// read with select('*') carries purge_after once it has; a creator route's
// row says so with removalReady.
export function has124(row) {
  if (!row || typeof row !== 'object') return false;
  if (hasOwn(row, 'removalReady')) return row.removalReady === true;
  return hasOwn(row, 'purge_after');
}

// When the files of a removal confirmed at `now` are deleted.
export function purgeAfterFrom(now = Date.now()) {
  const at = typeof now === 'number' ? now : Date.parse(now);
  return new Date((Number.isFinite(at) ? at : Date.now()) + HOLD_DAYS * DAY_MS).toISOString();
}

// What confirming a removal does: 'buyers' (someone bought it: withdrawn
// and kept for them for good), 'delete' (before 124: deleted at once, as
// before), 'later' (the owner asked to keep the files), or 'hold' (off the
// site, deleted for good HOLD_DAYS later).
export function confirmOutcome({ bought = false, keep = false, ready = true } = {}) {
  if (bought) return 'buyers';
  if (!ready) return 'delete';
  return keep ? 'later' : 'hold';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Dec 15" (UTC, as the clean-up runs), or '' for no date.
export function shortDay(iso) {
  const at = Date.parse(String(iso || ''));
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function isWithdrawnRow(row) {
  return Boolean(pick(row, 'withdrawnAt', 'withdrawn_at'));
}

// The team removed it (it wasn't the owner's request): an admin-started
// removal ("Removed by an admin: …"), or a title or show taken down after
// review (rejected while pulled). A creator route's row may say so itself
// (teamRemoved).
export function isTeamRemoved(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.teamRemoved === 'boolean') return row.teamRemoved;
  if (text(pick(row, 'deletionReason', 'deletion_reason')).startsWith(ADMIN_REMOVAL_PREFIX)) return true;
  if (text(pick(row, 'rejectionReason', 'rejection_reason')).startsWith(TAKEN_DOWN_PREFIX)) return true;
  const held = pick(row, 'held', 'moderation_hold') === true;
  return held && pick(row, 'status', 'status') === 'rejected';
}

// A removal the team started (its reason stored as "Removed by an admin:
// …"), whatever stage it is at: its owner can't cancel it — if it stopped
// part-way, only the team takes it back (Admin's Keep it / deny).
export function teamStartedRemoval(row) {
  return text(pick(row, 'deletionReason', 'deletion_reason')).startsWith(ADMIN_REMOVAL_PREFIX);
}

// The refusal of the owner's "cancel the removal request" on a removal the
// team started, or null (a full admin may; anyone else's own request may).
export function cancelRemovalRefusal(row, { isAdmin = false } = {}) {
  if (isAdmin === true || !teamStartedRemoval(row)) return null;
  return { status: 403, code: 'team-removal', error: REMOVAL_WORDS.teamCancel };
}

// Where a removed (withdrawn) title stands, or null for one that isn't:
// { key, label, tone, line, purgeDay }.
//   asked   the owner asked to bring it back; it waits for the team
//   held    off the site; deleted for good on purgeDay
//   later   off the site; the files kept until the owner asks
//   buyers  off the site; kept for the people who bought it
export function removedState(row) {
  if (!isWithdrawnRow(row)) return null;
  const purge = pick(row, 'purgeAfter', 'purge_after');
  const day = shortDay(purge);
  if (pick(row, 'restoreRequestedAt', 'restore_requested_at')) {
    return { key: 'asked', label: REMOVAL_WORDS.waitingBack, tone: 'review', line: REMOVAL_WORDS.askedLine, purgeDay: day };
  }
  if (purge) {
    return {
      key: 'held',
      label: day ? `Removed · deleted on ${day}` : 'Removed · deleted soon',
      tone: 'quiet',
      line: day ? `It’s off the site. We delete it for good on ${day} unless you ask to bring it back.` : 'It’s off the site. We delete it for good soon unless you ask to bring it back.',
      purgeDay: day
    };
  }
  if (pick(row, 'keepAfterRemoval', 'keep_after_removal') === true) {
    return { key: 'later', label: REMOVAL_WORDS.keptForLater, tone: 'quiet', line: 'It’s off the site. We keep the files until you ask to bring it back.', purgeDay: '' };
  }
  return { key: 'buyers', label: REMOVAL_WORDS.keptForBuyers, tone: 'quiet', line: 'It’s off the site. People who bought it keep it.', purgeDay: '' };
}

// Whether a removed title's owner may ask for it back now, as a page shows
// it: { ok, key, label?, line } — key 'ask' (ok), 'asked' (waiting on the
// team), 'with-show' (it came off with its show), 'team' (only a full
// admin), 'migration' (before 124) — or null for a title that isn't
// removed. `showWithdrawn` (a row may carry it): its show is removed too.
export function askBackFor(row, { isAdmin = false, showWithdrawn = null } = {}) {
  if (!isWithdrawnRow(row)) return null;
  if (!has124(row)) return { ok: false, key: 'migration', line: MIGRATION_124_LINE };
  if (pick(row, 'restoreRequestedAt', 'restore_requested_at')) return { ok: false, key: 'asked', line: REMOVAL_WORDS.askedLine };
  const withShow = showWithdrawn === null ? row.showWithdrawn === true : showWithdrawn === true;
  if (withShow) return { ok: false, key: 'with-show', line: REMOVAL_WORDS.withShow };
  if (isTeamRemoved(row) && isAdmin !== true) return { ok: false, key: 'team', line: REMOVAL_WORDS.teamOnly };
  return { ok: true, key: 'ask', label: REMOVAL_WORDS.askBack, line: REMOVAL_WORDS.askBackHelp };
}

// The server's answer to "ask to bring it back" (action 'request') or
// "take back the request" (action 'cancel'): null when it may go ahead,
// else { status, code, error }. `isOwner`: the viewer may ask for its
// removal (its uploader; a show's owner). A full admin may always ask.
export function restoreRefusal(row, { action = 'request', isOwner = false, isAdmin = false, showWithdrawn = false } = {}) {
  if (!row || typeof row !== 'object') return { status: 404, code: 'missing', error: 'That isn’t there any more.' };
  if (!has124(row)) return { status: 503, code: 'migration-124', error: MIGRATION_124_LINE };
  if (!isOwner && isAdmin !== true) return { status: 403, code: 'who', error: 'Only its owner can ask for it back.' };
  if (!isWithdrawnRow(row)) return { status: 409, code: 'not-removed', error: 'It isn’t removed, so there is nothing to bring back.' };
  const asked = Boolean(pick(row, 'restoreRequestedAt', 'restore_requested_at'));
  if (action === 'cancel') return asked ? null : { status: 409, code: 'not-asked', error: 'No request to bring it back is waiting.' };
  if (asked) return { status: 409, code: 'asked', error: 'You already asked; someone on the team looks at it soon.' };
  if (showWithdrawn === true) return { status: 409, code: 'with-show', error: REMOVAL_WORDS.withShow };
  if (isTeamRemoved(row) && isAdmin !== true) return { status: 403, code: 'team', error: REMOVAL_WORDS.teamOnly };
  return null;
}

// The optional note with a request to bring it back: trimmed, at most
// RESTORE_REASON_MAX characters, '' for none → { ok, reason } or
// { ok: false, error }.
export function cleanRestoreReason(value) {
  if (value === null || value === undefined) return { ok: true, reason: '' };
  if (typeof value !== 'string') return { ok: false, error: 'The note is text.' };
  const reason = value.trim();
  if (reason.length > RESTORE_REASON_MAX) return { ok: false, error: 'Keep the note under 1,000 characters.' };
  return { ok: true, reason };
}

// Whether the daily clean-up deletes this row now: removed, its hold run
// out, and no request to bring it back waiting (that is decided first).
export function purgeDue(row, now = Date.now()) {
  if (!isWithdrawnRow(row)) return false;
  if (pick(row, 'restoreRequestedAt', 'restore_requested_at')) return false;
  const at = Date.parse(String(pick(row, 'purgeAfter', 'purge_after') || ''));
  const t = typeof now === 'number' ? now : Date.parse(now);
  return Number.isFinite(at) && Number.isFinite(t) && at <= t;
}

// Whether "Delete now" (a full admin, a reason) may delete it: a removal
// someone asked for that isn't confirmed yet, or one held or kept for
// later — never anything bought (the caller reads the buyers).
export function deleteNowRefusal(row, { isAdmin = false, bought = false, reason = '' } = {}) {
  if (isAdmin !== true) return { status: 403, code: 'full-admin', error: 'A full admin deletes a title at once.' };
  if (!text(reason)) return { status: 400, code: 'reason', error: 'Say why — it’s kept in the audit log and the owner reads it.' };
  if (text(reason).length > 1000) return { status: 400, code: 'reason', error: 'Keep the reason under 1,000 characters.' };
  if (bought) return { status: 409, code: 'bought', error: REMOVAL_WORDS.boughtNoDelete };
  const requested = pick(row, 'deletionRequested', 'deletion_requested') === true;
  if (!isWithdrawnRow(row)) return requested ? null : { status: 409, code: 'not-requested', error: 'No removal is requested for this.' };
  const st = removedState(row);
  if (st && st.key === 'buyers') return { status: 409, code: 'bought', error: REMOVAL_WORDS.boughtNoDelete };
  return null;
}

// What the owner reads when the removal is confirmed.
export function confirmedMessage(name, outcome, purgeAfter) {
  const t = `“${text(name) || 'Your title'}”`;
  if (outcome === 'buyers') return `${t} is off Studio Tapa TV, as requested. People who bought it keep it, as the Terms say.`;
  if (outcome === 'later') return `${t} is off Studio Tapa TV, as requested. We keep its files until you ask to bring it back.`;
  if (outcome === 'hold') {
    const day = shortDay(purgeAfter);
    return `${t} is off Studio Tapa TV, as requested. We keep its files until ${day || 'a month from now'} in case you change your mind, then delete them for good.`;
  }
  return `${t} was permanently deleted, as requested.`;
}

// What the owner reads when the clean-up deletes it.
export function purgedMessage(name) {
  return `“${text(name) || 'Your title'}” was deleted for good, ${HOLD_DAYS} days after it was removed.`;
}

// The words of a request to bring a title back, as the review queue shows
// it (lib/reviewQueue.js): the subtitle line under its name.
export function restoreQueueLine({ kind = 'episode', ownerName = '', removedAt = null, purgeAfter = null, keep = false, teamRemoved = false } = {}) {
  const parts = [kind === 'series' ? 'Show' : 'Title'];
  if (ownerName) parts.push(`by ${ownerName}`);
  const removed = shortDay(removedAt);
  if (removed) parts.push(`removed ${removed}`);
  const purge = shortDay(purgeAfter);
  if (purge) parts.push(`files go ${purge}`);
  else if (keep) parts.push('kept for later');
  else parts.push('kept for buyers');
  if (teamRemoved) parts.push('the team removed it');
  return parts.join(' · ');
}
