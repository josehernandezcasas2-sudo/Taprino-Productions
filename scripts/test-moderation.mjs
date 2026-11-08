// node scripts/test-moderation.mjs — what /admin/content's review queue
// lists, as the nav's badge, the dashboard and the page count it
// (lib/moderationRules.js).
import assert from 'node:assert/strict';
import { queueTileCounts, reviewQueueKeys, typeOfKey } from '../lib/moderationRules.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok — ${name}`); } catch (err) { console.error(`FAIL — ${name}\n${err.stack}`); process.exitCode = 1; }
}

// getModerationState's shape: open flags, reports by item (counted, tier,
// ignored) and the items deleted since they were reported.
const mod = {
  flags: [
    { target_type: 'episode', target_id: 'night-bus-e1-lx3k9a', reason: 'copyright' },
    { target_type: 'episode', target_id: 'night-bus-e1-lx3k9a', reason: 'technical' },
    { target_type: 'call', target_id: '7a1f2c3d-0000-4000-8000-000000000001', reason: 'spam' },
    { target_type: 'tip', target_id: '7a1f2c3d-0000-4000-8000-000000000002', reason: 'hate' },
    { target_type: 'series', target_id: 'gone-show-lx3k9c', reason: 'other' }
  ],
  reportsByTarget: {
    'episode:night-bus-e1-lx3k9a': { total: 4, counted: 3, ignored: false, tier: 'minor' },
    'series:loud-show-lx3k9b': { total: 25, counted: 22, ignored: false, tier: 'yellow' },
    'profile:user_mara': { total: 60, counted: 55, ignored: false, tier: 'red' },
    'location:7a1f2c3d-0000-4000-8000-000000000003': { total: 3, counted: 3, ignored: true, tier: null },
    'production:7a1f2c3d-0000-4000-8000-000000000004': { total: 2, counted: 0, ignored: false, tier: null },
    'tip:7a1f2c3d-0000-4000-8000-000000000002': { total: 2, counted: 2, ignored: false, tier: 'minor' },
    'tip:7a1f2c3d-0000-4000-8000-000000000005': { total: 1, counted: 1, ignored: false, tier: 'minor' },
    'episode:deleted-film-lx3k9d': { total: 7, counted: 7, ignored: false, tier: 'minor' }
  },
  missing: [
    { key: 'episode:deleted-film-lx3k9d', targetType: 'episode', targetId: 'deleted-film-lx3k9d', reports: 7, flags: 0 },
    { key: 'series:gone-show-lx3k9c', targetType: 'series', targetId: 'gone-show-lx3k9c', reports: 0, flags: 1 }
  ]
};

test('the queue: one entry per item however many flags and reports, tip notes and deleted items left out', () => {
  const keys = reviewQueueKeys(mod).sort();
  assert.deepEqual(keys, [
    'call:7a1f2c3d-0000-4000-8000-000000000001',
    'episode:night-bus-e1-lx3k9a',
    'profile:user_mara',
    'series:loud-show-lx3k9b'
  ]);
  // The old badge added flags and reported items: 5 + 6 = 11 for these 4.
  const oldBadge = mod.flags.length + Object.values(mod.reportsByTarget).filter((t) => t.counted > 0 && !t.ignored).length;
  assert.equal(oldBadge, 11);
  assert.equal(reviewQueueKeys(mod).length, 4);
});

test('ignored reports and reports that don’t count leave an item out unless it is flagged', () => {
  assert.ok(!reviewQueueKeys(mod).includes('location:7a1f2c3d-0000-4000-8000-000000000003'));
  assert.ok(!reviewQueueKeys(mod).includes('production:7a1f2c3d-0000-4000-8000-000000000004'));
  const flagged = { ...mod, flags: [...mod.flags, { target_type: 'location', target_id: '7a1f2c3d-0000-4000-8000-000000000003', reason: 'spam' }] };
  assert.ok(reviewQueueKeys(flagged).includes('location:7a1f2c3d-0000-4000-8000-000000000003'));
});

test('the tiles: red/yellow/minor by item, flags by item, tip notes and deleted items apart', () => {
  assert.deepEqual(queueTileCounts(mod), { red: 1, yellow: 1, minor: 1, flag: 2, tipNotes: 2, missing: 2 });
  // Before anything is loaded, and an older state without `missing`.
  assert.deepEqual(queueTileCounts(null), { red: 0, yellow: 0, minor: 0, flag: 0, tipNotes: 0, missing: 0 });
  const noMissing = { ...mod, missing: undefined };
  assert.deepEqual(queueTileCounts(noMissing), { red: 1, yellow: 1, minor: 2, flag: 3, tipNotes: 2, missing: 0 });
  assert.equal(reviewQueueKeys(noMissing).length, 6);
});

test('keys split at the first colon only', () => {
  assert.equal(typeOfKey('profile:user_mara'), 'profile');
  assert.equal(typeOfKey('channel_media:a:b'), 'channel_media');
  assert.equal(typeOfKey(''), '');
});

console.log(`\n${passed} passed`);
