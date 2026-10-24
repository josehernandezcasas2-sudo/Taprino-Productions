// node scripts/test-suspensions.mjs — account suspensions (lib/suspensionRules.js).
import assert from 'node:assert/strict';
import { isActive, activeRows, suspensionPayload, blocks, untilLabel, validateSuspension } from '../lib/suspensionRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const now = new Date('2026-10-24T12:00:00Z');

t('active: not lifted and not past its end', () => {
  assert.equal(isActive({ scope: 'all', until_at: null }, now), true);
  assert.equal(isActive({ scope: 'all', until_at: '2026-11-23T00:00:00Z' }, now), true);
  assert.equal(isActive({ scope: 'all', until_at: '2026-10-01T00:00:00Z' }, now), false, 'ran out');
  assert.equal(isActive({ scope: 'all', lifted_at: '2026-10-20T00:00:00Z' }, now), false, 'lifted');
  assert.equal(isActive(null, now), false);
});

t('payload: the widest row wins, nothing in force → null', () => {
  const rows = [
    { scope: 'tips', public_reason: 'Abusive notes', until_at: null, created_at: '2026-10-10T00:00:00Z' },
    { scope: 'all', public_reason: 'Stolen card', until_at: '2026-11-23T00:00:00Z', created_at: '2026-10-20T00:00:00Z', cancel_membership: true }
  ];
  const p = suspensionPayload(rows, now);
  assert.equal(p.scope, 'all');
  assert.equal(p.reason, 'Stolen card');
  assert.equal(p.cancelMembership, true);
  assert.equal(activeRows(rows, now).length, 2);
  assert.equal(suspensionPayload([{ scope: 'all', lifted_at: '2026-10-21T00:00:00Z' }], now), null);
  assert.equal(suspensionPayload([], now), null);
});

t('blocks: all blocks everything, tips only tips', () => {
  assert.equal(blocks({ scope: 'all' }, 'tips'), true);
  assert.equal(blocks({ scope: 'all' }, 'all'), true);
  assert.equal(blocks({ scope: 'tips' }, 'tips'), true);
  assert.equal(blocks({ scope: 'tips' }, 'all'), false);
  assert.equal(blocks(null, 'all'), false);
});

t('until label', () => {
  assert.equal(untilLabel(null), 'until we hear from you');
  assert.equal(untilLabel('2026-11-23T20:00:00Z'), 'until November 23, 2026');
});

t('validate: scope, a real reason, a future end date', () => {
  assert.equal(validateSuspension({ scope: 'nope', publicReason: 'Abusive notes sent with tips' }).ok, false);
  assert.equal(validateSuspension({ scope: 'all', publicReason: 'short' }).ok, false);
  assert.equal(validateSuspension({ scope: 'all', publicReason: 'Abusive notes sent with tips', untilAt: '2020-01-01' }).ok, false);
  const ok = validateSuspension({ scope: 'tips', publicReason: '  Abusive   notes sent with tips ', untilAt: '2999-01-01' });
  assert.equal(ok.ok, true);
  assert.equal(ok.publicReason, 'Abusive notes sent with tips');
  assert.equal(ok.untilAt, '2999-01-01T20:00:00.000Z', 'a bare date is noon Pacific that day');
  assert.equal(untilLabel(ok.untilAt), 'until January 1, 2999');
  assert.equal(validateSuspension({ scope: 'all', publicReason: 'Abusive notes sent with tips' }).untilAt, null);
});

console.log(`${n} passed`);
