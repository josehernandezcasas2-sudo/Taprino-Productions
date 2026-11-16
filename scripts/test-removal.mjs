// node scripts/test-removal.mjs — removals held a month, titles brought
// back (migration 124, 2026-11-15; lib/removalRules.js): what confirming a
// removal does, where a removed title stands and its words, who may ask
// for it back and what the server refuses, the clean-up's due rule, "Delete
// now"'s refusals, the owner's cancel of a removal the team started, and
// Your work's rows and a title's dashboard for a removed title. The app's
// copy is checked word for word.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/removalRules.js';
import { buildWorkList } from '../lib/workListRules.js';
import { titleDashboard } from '../lib/titleDashRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const NOW = Date.parse('2026-11-15T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

t('the file imports nothing; the app copy is the website file word for word', () => {
  const web = readFileSync(new URL('../lib/removalRules.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../mobile/src/lib/removalRules.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(web));
  assert.equal(app, web);
});

t('HOLD_DAYS is 30 and the purge date is 30 days on', () => {
  assert.equal(R.HOLD_DAYS, 30);
  assert.equal(R.purgeAfterFrom(NOW), new Date(NOW + 30 * DAY).toISOString());
  assert.equal(R.shortDay(R.purgeAfterFrom(NOW)), 'Dec 15');
  assert.equal(R.shortDay(null), '');
  assert.equal(R.shortDay('not a date'), '');
});

t('migration 124 is read off a row (a database row or a creator route’s row)', () => {
  assert.equal(R.has124({ id: 'a', purge_after: null }), true);
  assert.equal(R.has124({ id: 'a' }), false);
  assert.equal(R.has124({ id: 'a', removalReady: true }), true);
  assert.equal(R.has124({ id: 'a', removalReady: false, purge_after: null }), false);
  assert.equal(R.has124(null), false);
});

t('confirming: bought → kept for buyers; before 124 → deleted; kept for later; else held', () => {
  assert.equal(R.confirmOutcome({ bought: true, keep: true }), 'buyers');
  assert.equal(R.confirmOutcome({ bought: true, ready: false }), 'buyers');
  assert.equal(R.confirmOutcome({ bought: false, ready: false, keep: true }), 'delete');
  assert.equal(R.confirmOutcome({ keep: true }), 'later');
  assert.equal(R.confirmOutcome({}), 'hold');
  assert.equal(R.CONFIRM_LABEL.hold, 'Remove · keep 30 days');
  assert.equal(R.CONFIRM_LABEL.buyers, 'Remove · kept for buyers');
  assert.equal(R.CONFIRM_LABEL.later, 'Remove · kept for later');
});

const held = { id: 'salt-b2', withdrawn_at: '2026-11-15T18:00:00Z', purge_after: '2026-12-15T18:00:00Z', keep_after_removal: false, restore_requested_at: null, deletion_requested: true, deletion_reason: 'Recut' };

t('where a removed title stands: held, kept for later, kept for buyers, waiting to come back', () => {
  assert.equal(R.removedState({ id: 'x', withdrawn_at: null }), null);
  assert.deepEqual(R.removedState(held).key, 'held');
  assert.equal(R.removedState(held).label, 'Removed · deleted on Dec 15');
  assert.match(R.removedState(held).line, /delete it for good on Dec 15/);
  assert.equal(R.removedState({ ...held, purge_after: null, keep_after_removal: true }).label, 'Removed · kept for later');
  assert.equal(R.removedState({ ...held, purge_after: null }).label, 'Removed · kept for buyers');
  assert.equal(R.removedState({ ...held, restore_requested_at: '2026-11-16T00:00:00Z' }).label, 'Waiting on us to bring it back');
  // camelCase rows read the same
  assert.equal(R.removedState({ withdrawnAt: held.withdrawn_at, purgeAfter: held.purge_after }).key, 'held');
  // a pre-124 withdrawal (kept for its buyers) reads as kept for buyers
  assert.equal(R.removedState({ withdrawn_at: '2026-10-01T00:00:00Z' }).key, 'buyers');
});

t('the team removed it: an admin-started removal, or a take-down', () => {
  assert.equal(R.isTeamRemoved({ deletion_reason: 'Removed by an admin: spam' }), true);
  assert.equal(R.isTeamRemoved({ rejection_reason: 'Taken down after review: stolen' }), true);
  assert.equal(R.isTeamRemoved({ moderation_hold: true, status: 'rejected' }), true);
  assert.equal(R.isTeamRemoved({ held: true, status: 'rejected' }), true);
  assert.equal(R.isTeamRemoved({ deletion_reason: 'Recut', status: 'approved' }), false);
  assert.equal(R.isTeamRemoved({ teamRemoved: false, deletion_reason: 'Removed by an admin: x' }), false, 'a route’s own answer wins');
});

t('asking for it back: who, when, and the words', () => {
  assert.equal(R.askBackFor({ withdrawn_at: null }), null);
  assert.equal(R.askBackFor({ withdrawn_at: 'x' }).key, 'migration');
  assert.equal(R.askBackFor(held).ok, true);
  assert.equal(R.askBackFor(held).label, 'Ask to bring it back');
  assert.equal(R.askBackFor({ ...held, restore_requested_at: 'y' }).key, 'asked');
  assert.equal(R.askBackFor(held, { showWithdrawn: true }).key, 'with-show');
  assert.equal(R.askBackFor({ ...held, showWithdrawn: true }).key, 'with-show');
  const team = { ...held, deletion_reason: 'Removed by an admin: abuse' };
  assert.equal(R.askBackFor(team).key, 'team');
  assert.equal(R.askBackFor(team, { isAdmin: true }).ok, true);
});

t('the server refuses a request it can’t take', () => {
  assert.equal(R.restoreRefusal({ id: 'a' }, { isOwner: true }).code, 'migration-124');
  assert.equal(R.restoreRefusal({ ...held, withdrawn_at: null }, { isOwner: true }).code, 'not-removed');
  assert.equal(R.restoreRefusal(held, { isOwner: false }).status, 403);
  assert.equal(R.restoreRefusal(held, { isOwner: true }), null);
  assert.equal(R.restoreRefusal(held, { isAdmin: true }), null);
  assert.equal(R.restoreRefusal({ ...held, restore_requested_at: 'y' }, { isOwner: true }).code, 'asked');
  assert.equal(R.restoreRefusal(held, { isOwner: true, showWithdrawn: true }).code, 'with-show');
  assert.equal(R.restoreRefusal({ ...held, deletion_reason: 'Removed by an admin: x' }, { isOwner: true }).code, 'team');
  assert.equal(R.restoreRefusal({ ...held, deletion_reason: 'Removed by an admin: x' }, { isAdmin: true }), null);
  // taking the request back
  assert.equal(R.restoreRefusal(held, { action: 'cancel', isOwner: true }).code, 'not-asked');
  assert.equal(R.restoreRefusal({ ...held, restore_requested_at: 'y' }, { action: 'cancel', isOwner: true }), null);
});

t('the note with a request: optional, at most 1,000 characters', () => {
  assert.deepEqual(R.cleanRestoreReason(undefined), { ok: true, reason: '' });
  assert.deepEqual(R.cleanRestoreReason('  back please  '), { ok: true, reason: 'back please' });
  assert.equal(R.cleanRestoreReason('x'.repeat(1001)).ok, false);
  assert.equal(R.cleanRestoreReason(5).ok, false);
});

t('the clean-up: due once the hold ran out, never while asked back', () => {
  assert.equal(R.purgeDue(held, NOW), false);
  assert.equal(R.purgeDue(held, NOW + 31 * DAY), true);
  assert.equal(R.purgeDue({ ...held, restore_requested_at: 'y' }, NOW + 31 * DAY), false);
  assert.equal(R.purgeDue({ ...held, purge_after: null, keep_after_removal: true }, NOW + 400 * DAY), false);
  assert.equal(R.purgeDue({ ...held, withdrawn_at: null }, NOW + 31 * DAY), false);
});

t('Delete now: a full admin, a reason, never anything bought', () => {
  const open = { deletion_requested: true, withdrawn_at: null };
  assert.equal(R.deleteNowRefusal(open, { isAdmin: false, reason: 'abuse' }).status, 403);
  assert.equal(R.deleteNowRefusal(open, { isAdmin: true, reason: '  ' }).code, 'reason');
  assert.equal(R.deleteNowRefusal(open, { isAdmin: true, reason: 'abuse', bought: true }).code, 'bought');
  assert.equal(R.deleteNowRefusal(open, { isAdmin: true, reason: 'abuse' }), null);
  assert.equal(R.deleteNowRefusal({ deletion_requested: false, withdrawn_at: null }, { isAdmin: true, reason: 'abuse' }).code, 'not-requested');
  assert.equal(R.deleteNowRefusal(held, { isAdmin: true, reason: 'abuse' }), null);
  assert.equal(R.deleteNowRefusal({ ...held, purge_after: null }, { isAdmin: true, reason: 'abuse' }).code, 'bought', 'kept for buyers stays');
});

t('a removal the team started: the owner can’t cancel it (or ask it again)', () => {
  const team = { deletion_requested: true, deletion_reason: 'Removed by an admin: spam' };
  assert.equal(R.teamStartedRemoval(team), true);
  assert.equal(R.teamStartedRemoval({ deletionReason: 'Removed by an admin: spam' }), true);
  assert.equal(R.cancelRemovalRefusal(team).code, 'team-removal');
  assert.equal(R.cancelRemovalRefusal(team, { isAdmin: true }), null);
  assert.equal(R.cancelRemovalRefusal({ deletion_reason: 'Recut' }), null);
});

t('the owner’s messages and the queue line', () => {
  assert.match(R.confirmedMessage('Salt', 'hold', held.purge_after), /until Dec 15/);
  assert.match(R.confirmedMessage('Salt', 'later'), /until you ask to bring it back/);
  assert.match(R.confirmedMessage('Salt', 'buyers'), /People who bought it keep it/);
  assert.match(R.confirmedMessage('Salt', 'delete'), /permanently deleted/);
  assert.equal(R.purgedMessage('Salt'), '“Salt” was deleted for good, 30 days after it was removed.');
  assert.equal(R.restoreQueueLine({ kind: 'episode', ownerName: 'Mara', removedAt: held.withdrawn_at, purgeAfter: held.purge_after }), 'Title · by Mara · removed Nov 15 · files go Dec 15');
  assert.equal(R.restoreQueueLine({ kind: 'series', keep: true, teamRemoved: true }), 'Show · kept for later · the team removed it');
});

// --- Your work and a title's dashboard ------------------------------------------------------

const base = {
  status: 'approved', contentType: 'movie', seriesId: null, seriesStatus: null, seriesHeld: false, season: null, seriesOrder: null,
  runtime: '22:40', viewCount: 0, captionsUrl: '/api/captions/x', captionsStale: false, poster: 'p.jpg', thumbnail: 't.jpg', missingArtwork: false,
  held: false, deletionRequested: false, withdrawnAt: null, cloudflareState: 'ready', canPrice: true, hasVideo: true, hasAudio: false, createdAt: '2026-11-01T00:00:00Z',
  removalReady: true, purgeAfter: null, keepAfterRemoval: false, restoreRequestedAt: null, teamRemoved: false, showWithdrawn: false
};
const removed = { ...base, id: 'salt-b2', title: 'Salt', deletionRequested: true, deletionReason: 'Recut', withdrawnAt: held.withdrawn_at, purgeAfter: held.purge_after };

function rowOf(sub) {
  const list = buildWorkList({ submissions: [sub], shows: [], now: NOW });
  for (const sec of list.sections) for (const r of sec.rows || []) if (r.id === sub.id) return r;
  return null;
}

t('Your work: a held title reads where it stands and offers Ask to bring it back', () => {
  const r = rowOf(removed);
  assert.equal(r.pill.label, 'Removed · deleted on Dec 15');
  assert.deepEqual(r.next, { key: 'restore', label: 'Ask to bring it back' });
  assert.ok(r.menu.some((m) => m.key === 'restore'));
  assert.ok(!r.menu.some((m) => m.key === 'remove' || m.key === 'cancel_removal'));
  assert.match(r.waiting, /delete it for good on Dec 15/);
});

t('Your work: waiting on the team — no next step, the request can be taken back', () => {
  const r = rowOf({ ...removed, restoreRequestedAt: '2026-11-16T00:00:00Z' });
  assert.equal(r.pill.label, 'Waiting on us to bring it back');
  assert.equal(r.next, null);
  assert.ok(r.menu.some((m) => m.key === 'cancel_restore'));
});

t('Your work: kept for buyers / later; the team removed it; before 124', () => {
  assert.equal(rowOf({ ...removed, purgeAfter: null }).pill.label, 'Removed · kept for buyers');
  assert.equal(rowOf({ ...removed, purgeAfter: null, keepAfterRemoval: true }).pill.label, 'Removed · kept for later');
  const team = rowOf({ ...removed, teamRemoved: true });
  assert.equal(team.next, null);
  assert.match(team.waiting, /only a full admin can bring it back/);
  assert.equal(rowOf({ ...removed, removalReady: false }).next, null);
});

t('Your work: a removal the team started has no Cancel', () => {
  const r = rowOf({ ...base, id: 'echo-b5', title: 'Echo', deletionRequested: true, deletionReason: 'Removed by an admin: spam' });
  assert.equal(r.next, null);
  assert.ok(!r.menu.some((m) => m.key === 'cancel_removal'));
  const own = rowOf({ ...base, id: 'echo-b6', title: 'Echo', deletionRequested: true, deletionReason: 'Recut' });
  assert.equal(own.next.key, 'cancel_removal');
});

t('a title’s dashboard: the removal card for a removed title', () => {
  const d = titleDashboard({ title: removed, now: NOW });
  assert.equal(d.removal.key, 'restore');
  assert.equal(d.head.pill.label, 'Removed · deleted on Dec 15');
  assert.ok(d.history.some((h) => h.what === 'Taken off the site'));
  const asked = titleDashboard({ title: { ...removed, restoreRequestedAt: '2026-11-16T00:00:00Z' }, now: NOW });
  assert.equal(asked.removal.key, 'cancel_restore');
  const team = titleDashboard({ title: { ...removed, teamRemoved: true }, now: NOW });
  assert.equal(team.removal.key, null);
  const live = titleDashboard({ title: { ...base, id: 'live-a1', title: 'Live' }, now: NOW });
  assert.equal(live.removal.key, 'remove');
  assert.match(live.removal.line, /30 days/);
});

// --- 2026-11-15 review --------------------------------------------------------------------

t('an admin trying to remove (or keep) something already removed reads where it stands', () => {
  assert.equal(R.alreadyRemovedLine({ ...held, purge_after: null }), 'It was removed already and is kept for the people who bought from it.');
  assert.equal(R.alreadyRemovedLine({ withdrawn_at: '2026-10-01T00:00:00Z' }), 'It was removed already and is kept for the people who bought from it.', 'before 124');
  assert.equal(R.alreadyRemovedLine(held), 'It was removed already; its files are deleted for good on Dec 15.');
  assert.equal(R.alreadyRemovedLine({ ...held, purge_after: null, keep_after_removal: true }), 'It was removed already; its files are kept until its owner asks for it back.');
  assert.match(R.alreadyRemovedLine({ ...held, restore_requested_at: 'y' }), /asked to bring it back/);
});

t('once its hold has run out it can’t be asked back (the clean-up may be deleting it)', () => {
  const after = Date.parse(held.purge_after) + 1000;
  const before = Date.parse(held.purge_after) - 1000;
  assert.equal(R.restoreRefusal(held, { isOwner: true, now: after }).code, 'due');
  assert.equal(R.restoreRefusal(held, { isOwner: true, now: after }).status, 409);
  assert.equal(R.restoreRefusal(held, { isOwner: true, now: before }), null);
  assert.equal(R.restoreRefusal(held, { isOwner: true }), null, 'only when the caller passes the time');
  assert.equal(R.restoreRefusal({ ...held, purge_after: null, keep_after_removal: true }, { isOwner: true, now: after }), null, 'kept for later never runs out');
  assert.equal(R.restoreRefusal({ ...held, restore_requested_at: 'y' }, { action: 'cancel', isOwner: true, now: after }), null, 'taking a request back is always fine');
  assert.equal(R.askBackFor(held, { now: after }).key, 'due');
  assert.equal(R.askBackFor(held, { now: after }).line, R.REMOVAL_WORDS.due);
  assert.equal(R.askBackFor(held, { now: before }).ok, true);
  assert.equal(R.askBackFor(held).ok, true, 'a page that leaves the time out never changes its answer with the clock');
});

t('a title whose availability window ended comes back without one, and the queue says so', () => {
  assert.equal(R.windowEnded('2026-11-01T00:00:00Z', NOW), true);
  assert.equal(R.windowEnded('2026-12-01T00:00:00Z', NOW), false);
  assert.equal(R.windowEnded(null, NOW), false);
  assert.equal(R.restoreQueueLine({ kind: 'episode', purgeAfter: held.purge_after, expired: true }), 'Title · files go Dec 15 · its availability window ended — it comes back with no end date');
});

// The server's half, read from the source (the rig check
// dev/test-rig/checks/removal-hold.mjs runs it against a database).
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

t('a show’s removal holds what it meets: one moment, one deadline, the extras left where they are', () => {
  const del = src('lib/showDelete.js');
  // The plan comes from buyers (cascadePlan), "Delete now" plans by buyers alone.
  assert.match(del, /const deleteNow = ready && \(mode === 'now' \|\| \(mode === 'purge' && force\)\)/);
  assert.match(del, /asPlanned = \(r\) => \(deleteNow \? \{ \.\.\.r, withdrawn_at: null \} : r\)/);
  // The hold returns before the extras are re-filed.
  assert.ok(del.indexOf("if (mode === 'hold') {\n    return holdShow(") < del.indexOf('refileExtrasUnderShow(episodes.filter'), 'the hold never re-files extras');
  // Step 1 only takes off what is still up; the moment and deadline come from the claimed show.
  assert.match(del, /update\(patch\)\.eq\('id', r\.id\)\.is\('withdrawn_at', null\)/);
  assert.match(del, /moment = fresh\.withdrawn_at/);
  assert.match(del, /const heldUntil = purgeAfterFrom\(Date\.parse\(moment\)\)/);
  // "Keep the files" is never taken from a removal the team started.
  assert.match(del, /const keep = mode === 'hold' && !byAdmin && show\.keep_after_removal === true/);
  assert.match(del, /const rowKeep = \(r\) => !byAdmin && /);
  // A show kept at the clean-up only for later reads as kept for later.
  assert.match(del, /keep_after_removal: true \} : \{\}\) \}\)\.eq\('id', show\.id\)/);
});

t('the team’s "keep the files": cleared on a deny and on a removal the team starts', () => {
  const adm = src('lib/showAdmin.js');
  assert.match(adm, /deletion_requested_at: null, \.\.\.\(has124\(show\) \? \{ keep_after_removal: false \} : \{\}\)/);
  assert.equal((adm.match(/deletion_requested_at: new Date\(\)\.toISOString\(\), \.\.\.\(has124\(show\) \? \{ keep_after_removal: false \} : \{\}\)/g) || []).length, 2, 'both ways an admin starts one');
  assert.ok(!adm.includes("'It was removed already and is kept for the people who bought from it.'"), 'the words come from removedState');
  assert.match(src('pages/api/admin/resolve-deletion.js'), /keep: row\.keep_after_removal === true && !teamStartedRemoval\(row\)/);
});

t('the clean-up: pages past titles left to their show; checks a row again before any side effect', () => {
  const tr = src('lib/titleRemoval.js');
  assert.match(tr, /\.range\(offset, offset \+ PURGE_PAGE - 1\)/);
  assert.match(tr, /offset \+= stay/);
  assert.match(tr, /if \(!row \|\| !stillToDelete\(row, mode, asked\)\) return \{ deleted: false, refiled: 0 \}/);
  assert.ok(tr.indexOf('stillToDelete(row, mode, asked)') < tr.indexOf('creditAdShareBeforeDelete([row]'), 'checked before the ad share');
  // A show brought back: its owners are everyone whose titles come back with it.
  assert.match(tr, /if \(type === 'series'\) return showOwnerIds\(row\.id/);
  assert.match(src('lib/moderation.js'), /owners = await showOwnerIds\(target\.id/);
  // A request lands only before the hold runs out — two plain filters
  // (PostgREST refuses an or() on an update).
  assert.match(tr, /row\.purge_after \? q\.gt\('purge_after', new Date\(now\)\.toISOString\(\)\) : q\.is\('purge_after', null\)/);
  assert.doesNotMatch(tr, /\.or\(`purge_after/);
});

t('an owner\'s reason can\'t open with the team\'s words (2026-11-16), and the server refuses it before storing it', () => {
  for (const forged of [
    'Removed by an admin: please',
    'removed by an admin: please',
    '  Removed  by   an admin:please',
    '\u200BRemoved by an admin: hidden opening',
    'Re\u00ADmoved by an admin: soft hyphen',
    '\uFEFFRemoved\u2060 by an admin: joiner',
    'Taken down after review: mine',
    'TAKEN DOWN AFTER REVIEW:'
  ]) {
    const r = R.ownerReasonRefusal(forged);
    assert.ok(r, JSON.stringify(forged));
    assert.equal(r.status, 400);
    assert.equal(r.code, 'team-words');
    assert.equal(r.error, R.OWN_REASON_LINE);
  }
  for (const fine of ['Recut', 'I was removed by an admin: no', 'Removed by me', 'Removed by an administrator', '', null, undefined, 42]) {
    assert.equal(R.ownerReasonRefusal(fine), null, String(fine));
  }
  // What a team-started removal reads as stays the stored opening.
  assert.equal(R.teamStartedRemoval({ deletion_reason: `${R.ADMIN_REMOVAL_PREFIX}abuse` }), true);
  // Both owner requests check it before writing (lib/showPage.js), and the
  // two denials need a full admin for a removal the team started.
  const sp = readFileSync(new URL('../lib/showPage.js', import.meta.url), 'utf8');
  assert.equal((sp.match(/const teamWords = action === 'request' \? ownerReasonRefusal\(why\) : null;/g) || []).length, 2);
  const sa = readFileSync(new URL('../lib/showAdmin.js', import.meta.url), 'utf8');
  assert.match(sa, /const adminStarted = teamStartedRemoval\(show\);\n  if \(adminStarted\) needFullAdmin\(rc\);/);
  const rd = readFileSync(new URL('../pages/api/admin/resolve-deletion.js', import.meta.url), 'utf8');
  assert.match(rd, /if \(teamStarted && roleContext\.isAdmin !== true\)/);
});

console.log(`\n${n} removal checks passed`);
