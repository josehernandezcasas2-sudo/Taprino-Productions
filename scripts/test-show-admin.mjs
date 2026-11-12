// node scripts/test-show-admin.mjs — the admin side of shows' pure rules
// (lib/showAdminRules.js, the series revamp's slice 3a): the capability
// labels against lib/capabilities.js, the disabled lines, the Shows list's
// filters and badges, the batch refusal's summary and a History line.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/showAdminRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-05T18:00:00Z');
const ep = (id, number, extra = {}) => ({ id, season: 1, series_order: number, title: `T-${id}`, content_type: 'series', status: 'approved', series_id: 'night-bus', submitted_by: 'u_mara', created_at: '2026-10-01T00:00:00Z', ...extra });

t('the five capabilities and their labels match lib/capabilities.js', () => {
  assert.deepEqual(R.SHOW_ADMIN_CAPS, ['manage_episodes', 'review_submissions', 'manage_artwork', 'manage_deletions', 'handle_flags']);
  const source = readFileSync(new URL('../lib/capabilities.js', import.meta.url), 'utf8');
  for (const cap of R.SHOW_ADMIN_CAPS) {
    const block = new RegExp(`key: '${cap}',\\s*label: '([^']+)'`).exec(source);
    assert.ok(block, `${cap} is in lib/capabilities.js`);
    assert.equal(R.CAP_LABELS[cap], block[1], cap);
  }
  assert.ok(!/^\s*import\s.*from '\.\/(?!showRules\.js)/m.test(readFileSync(new URL('../lib/showAdminRules.js', import.meta.url), 'utf8')), 'imports only lib/showRules.js');
});

t('the disabled lines', () => {
  assert.equal(R.capLine('review_submissions'), 'Needs “Review creator submissions”.');
  assert.equal(R.capLine('handle_flags'), 'Needs “Flag content & handle reports”.');
  assert.equal(R.capLine('constructor'), R.FULL_ADMIN_LINE, 'an unknown key is a full admin’s, never a prototype read');
  assert.equal(R.FULL_ADMIN_LINE, 'A full admin does this.');
  assert.equal(R.makePublicLine('Mara'), 'Mara or a full admin makes it public.');
  assert.equal(R.makePublicLine(''), 'Its owner or a full admin makes it public.');
  assert.equal(R.makePublicLine(null), 'Its owner or a full admin makes it public.');
  assert.deepEqual(R.TIER_CHOICES.map(([k]) => k), ['keep', 'free', 'premium']);
});

t('the filters list', () => {
  assert.deepEqual(R.ADMIN_SHOW_FILTERS.map(([k]) => k), ['all', 'live', 'ready', 'first', 'review', 'staged', 'pulled', 'removal', 'podcasts', 'problems', 'week']);
  assert.deepEqual(R.ADMIN_SHOW_FILTER_KEYS, R.ADMIN_SHOW_FILTERS.map(([k]) => k));
  assert.equal(R.ADMIN_SHOW_FILTERS[2][1], 'Ready to go public');
});

t('adminShowFilterKeys: live, ready, first, review', () => {
  const live = { id: 'night-bus', status: 'approved', public_at: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' };
  assert.deepEqual(R.adminShowFilterKeys(live, [ep('a', 1)], { now: NOW }), ['all', 'live']);
  const priv = { id: 'night-bus', status: 'pending', created_at: '2026-11-01T00:00:00Z' };
  assert.deepEqual(R.adminShowFilterKeys(priv, [ep('a', 1)], { now: NOW }), ['all', 'ready']);
  assert.deepEqual(R.adminShowFilterKeys(priv, [ep('a', 1, { status: 'pending' })], { now: NOW }), ['all', 'first', 'review']);
  assert.deepEqual(R.adminShowFilterKeys(priv, [], { now: NOW }), ['all', 'first'], 'empty for under a week is not a problem yet');
  assert.ok(R.adminShowFilterKeys({ ...priv, created_at: '2026-10-01T00:00:00Z' }, [], { now: NOW }).includes('problems'), 'empty for more than 7 days');
  assert.ok(!R.adminShowFilterKeys({ ...priv, moderation_hold: true }, [ep('a', 1)], { now: NOW }).includes('ready'), 'a pulled show isn’t ready');
  assert.ok(!R.adminShowFilterKeys({ ...priv, deletion_requested: true }, [ep('a', 1)], { now: NOW }).includes('ready'));
  assert.ok(R.adminShowFilterKeys(priv, [ep('a', 1, { status: 'rejected' })], { now: NOW }).includes('first'), 'a declined episode isn’t approved');
});

t('adminShowFilterKeys: staged (120 included), pulled, removal, podcasts, problems, week', () => {
  const live = { id: 'night-bus', status: 'approved', public_at: '2026-10-01T00:00:00Z' };
  const has = (show, rows, key) => R.adminShowFilterKeys(show, rows, { now: NOW }).includes(key);
  assert.ok(has({ ...live, pending_poster: 'x' }, [ep('a', 1)], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pending_title: 'New' })], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pending_src: 'v' })], 'staged'), 'a new file waiting');
  assert.ok(has(live, [ep('a', 1, { pending_title_image_url: 'i' })], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pending_title_image_removal: true })], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pendingTrailerSrc: 't' })], 'staged'), 'camelCase too');
  assert.ok(!has(live, [ep('a', 1, { pending_title_image_removal: false })], 'staged'));
  // A show's season art waiting (migration 122): a removal counts, an
  // empty list or none doesn't.
  assert.ok(has({ ...live, pending_season_art: [{ number: 2, image: null }] }, [ep('a', 1)], 'staged'), 'season art waiting');
  assert.ok(has({ ...live, pending_season_art: '[{"number":2,"image":"https://x/a.jpg"}]' }, [ep('a', 1)], 'staged'), 'as text');
  assert.ok(!has({ ...live, pending_season_art: [] }, [ep('a', 1)], 'staged'));
  assert.ok(!has({ ...live, pending_season_art: null }, [ep('a', 1)], 'staged'));
  // Page notes waiting (migration 122, 2026-11-12): '' = clearing them waits.
  assert.ok(has(live, [ep('a', 1, { pending_page_notes: 'New notes.' })], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pending_page_notes: '' })], 'staged'), 'clearing the notes waits too');
  assert.ok(!has(live, [ep('a', 1, { pending_page_notes: null })], 'staged'));
  assert.ok(has(live, [ep('a', 1, { pending_description: 'New words.' })], 'staged'));
  assert.ok(has({ ...live, moderation_hold: true }, [], 'pulled'));
  assert.ok(!has({ ...live, moderation_hold: true }, [], 'live'));
  assert.ok(has({ ...live, deletion_requested: true }, [], 'removal'));
  // Removed already and kept for its buyers: no open request, not live.
  const kept = { ...live, deletion_requested: true, withdrawn_at: '2026-11-03T00:00:00Z' };
  assert.ok(!has(kept, [], 'removal') && !has(kept, [], 'live'));
  assert.deepEqual(R.adminShowBadges(kept, []).filter((b) => b.key === 'removal' || b.key === 'kept').map((b) => b.key), ['kept']);
  assert.ok(has({ ...live, kind: 'podcast' }, [], 'podcasts'));
  assert.ok(has(live, [ep('a', 1, { content_type: 'podcast' })], 'podcasts'), 'the kind from the episodes');
  assert.ok(has(live, [ep('a', 1), ep('b', 1)], 'problems'), 'a duplicate');
  assert.ok(has(live, [ep('a', 1), ep('b', null)], 'problems'), 'an unnumbered row');
  assert.ok(has(live, [ep('a', 1), ep('b', 1009)], 'problems'), 'a parked number');
  assert.ok(!has(live, [ep('a', 1), ep('b', 3)], 'problems'), 'a gap is a badge, not the Problems filter');
  assert.ok(has({ ...live, public_at: new Date(NOW - 2 * DAY).toISOString() }, [], 'week'));
  assert.ok(!has({ ...live, public_at: new Date(NOW - 8 * DAY).toISOString() }, [], 'week'));
  assert.deepEqual(R.adminShowFilterKeys(null, []), []);
});

t('adminShowBadges in their order', () => {
  const priv = { id: 'night-bus', status: 'pending', created_at: '2026-11-01T00:00:00Z', poster: null, thumbnail: null, pending_name: 'New name' };
  const rows = [ep('a', 1), ep('b', 1, { status: 'pending' }), ep('c', 3, { status: 'pending', pending_src: 'v' }), ep('d', null, { status: 'pending' })];
  const badges = R.adminShowBadges(priv, rows, { now: NOW });
  assert.deepEqual(badges.map((b) => b.key), ['review', 'ready', 'staged', 'video', 'duplicate', 'numbers', 'noart']);
  assert.deepEqual(badges[0], { key: 'review', words: '3 in review', tone: 'review' });
  assert.deepEqual(badges[1], { key: 'ready', words: 'Ready to go public', tone: 'ok' });
  assert.equal(badges.find((b) => b.key === 'duplicate').words, 'E1 twice');
  assert.equal(badges.find((b) => b.key === 'video').words, 'New file waiting');
  assert.equal(badges.find((b) => b.key === 'numbers').tone, 'warn');
  const pulled = R.adminShowBadges({ id: 's', status: 'approved', moderation_hold: true, deletion_requested: true, poster: 'p' }, [], { now: NOW });
  assert.deepEqual(pulled.map((b) => [b.key, b.tone]), [['removal', 'neutral'], ['pulled', 'danger'], ['empty', 'neutral']]);
  const two = R.adminShowBadges({ id: 's', status: 'approved', poster: 'p' }, [ep('a', 1), ep('b', 1, { season: 2 }), ep('c', 1, { season: 2 })], { now: NOW });
  assert.equal(two.find((b) => b.key === 'duplicate').words, 'S2 E1 twice', 'with seasons, the season is named');
});

t('batchSummary: files of one kind, else the first problem', () => {
  assert.equal(R.batchSummary([{ master: 'processing', words: 'x' }, { master: 'processing' }, { master: 'processing' }], 12), '3 of 12 are still processing');
  assert.equal(R.batchSummary([{ master: 'processing' }], 3), '1 of 3 is still processing');
  assert.equal(R.batchSummary([{ master: 'uploading' }], 4), '1 of 4 is still uploading');
  assert.equal(R.batchSummary([{ master: 'error' }, { master: 'deleted' }], 5), '2 of 5 failed to process');
  assert.equal(R.batchSummary([{ master: 'processing', words: 'S1 E2: the video is still processing' }, { master: 'uploading', words: 'S1 E3: …' }], 5), 'S1 E2: the video is still processing — and 1 more');
  assert.equal(R.batchSummary([{ words: 'S1 E4: Give it an episode number before approving it.' }], 3), 'S1 E4: Give it an episode number before approving it');
  assert.equal(R.batchSummary([{ words: 'Not yet: the video is still uploading.' }, { words: 'b' }, { words: 'c' }], 3), 'the video is still uploading — and 2 more');
  assert.equal(R.batchSummary([], 3), '');
});

t('historyEntry: owner rows name the owner, admin rows the admin and “(admin)”', () => {
  const owner = R.historyEntry({ id: 1, admin_id: 'u_mara', admin_email: 'mara@example.com', action: 'show_reorder', target_type: 'series', target_id: 'night-bus', details: JSON.stringify({ actor: 'owner', words: 'Night Bus: S1: E7→E3' }), created_at: '2026-11-04T22:12:00Z' }, { u_mara: 'Mara Reyes' });
  assert.deepEqual(owner, { id: 1, at: '2026-11-04T22:12:00Z', action: 'show_reorder', actor: 'owner', who: 'Mara Reyes', words: 'Night Bus: S1: E7→E3', targetType: 'series', targetId: 'night-bus' });
  const admin = R.historyEntry({ id: 2, admin_id: 'u_jose', admin_email: 'jose@example.com', action: 'approve_show_episodes', details: JSON.stringify({ actor: 'admin', words: '12 approved' }) }, {});
  assert.equal(admin.who, 'jose@example.com (admin)');
  assert.equal(admin.actor, 'admin');
  const plain = R.historyEntry({ id: 3, admin_id: 'cron', admin_email: null, action: 'auto_flag_expired_content', details: '2 item(s)' }, {});
  assert.deepEqual([plain.actor, plain.who, plain.words], [null, 'The site', '2 item(s)']);
  assert.equal(R.historyEntry({ details: '{not json' }, {}).words, '{not json');
  assert.equal(R.historyEntry({ admin_id: 'u_x', action: 'show_reorder', details: JSON.stringify({ actor: 'owner', words: 'w' }) }, (id) => (id === 'u_x' ? 'Xan' : null)).who, 'Xan');
  assert.equal(R.historyEntry({ admin_id: 'constructor', action: 'show_reorder', details: JSON.stringify({ actor: 'owner', words: 'w' }) }, {}).who, 'The owner', 'names are read as own properties');
  // Text someone typed (a film's title in approve_submission, an ad's name)
  // never passes for an owner's JSON line.
  const typed = JSON.stringify({ actor: 'owner', words: 'edited a description' });
  const forged = R.historyEntry({ admin_id: 'u_jose', admin_email: 'jose@example.com', action: 'approve_submission', details: typed }, {});
  assert.deepEqual([forged.actor, forged.words, forged.who], [null, typed, 'jose@example.com']);
  assert.equal(R.historyEntry({ action: 'show_live', details: JSON.stringify({ actor: 'owner', words: 'w' }) }, {}).actor, 'owner');
  // Who gets paid (slice 3b): an invitee answering, a paid account stepping down.
  const payee = R.historyEntry({ admin_id: 'u_pat', admin_email: 'pat@example.com', action: 'payee_invite_accepted', details: JSON.stringify({ actor: 'payee', words: 'Night Bus: Pat Lee accepted' }) }, { u_pat: 'Pat Lee' });
  assert.deepEqual([payee.actor, payee.who, payee.words], ['payee', 'Pat Lee', 'Night Bus: Pat Lee accepted']);
  assert.equal(R.historyEntry({ admin_id: 'u_x', action: 'payee_stepped_down', details: JSON.stringify({ actor: 'payee', words: 'w' }) }, {}).who, 'The paid account');
  for (const action of ['payee_invite_sent', 'payee_invite_cancelled', 'payee_invite_declined', 'payee_set', 'payee_cutover', 'payee_repaired']) assert.ok(R.JSON_DETAIL_ACTIONS.has(action), action);
});

console.log(`\n${n} show-admin checks passed`);
