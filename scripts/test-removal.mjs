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

console.log(`\n${n} removal checks passed`);
