// node scripts/test-tips.mjs — tips (lib/tipRules.js).
import assert from 'node:assert/strict';
import { tipQuote, parseTipAmount, validateTipInput, tipEmailDue, tipperLabel, safeTipReturn, tippedState, TIP_PRESETS_CENTS, MIN_TIP_CENTS, DEFAULT_TIP_MAX_CENTS, MAX_NOTE_CHARS } from '../lib/tipRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('quote: the fan covers the card fee, the creator keeps 95%', () => {
  assert.deepEqual(tipQuote(500, 5), { amountCents: 500, creatorCents: 475, cutCents: 25, feeCents: 46, totalCents: 546, cutPercent: 5, cutMaxCents: 10000, capped: false });
  assert.deepEqual(tipQuote(300, 5), { amountCents: 300, creatorCents: 285, cutCents: 15, feeCents: 40, totalCents: 340, cutPercent: 5, cutMaxCents: 10000, capped: false });
  assert.equal(tipQuote(1000, 5).totalCents, 1061);
  assert.equal(tipQuote(2500, 5).creatorCents, 2375);
  assert.equal(tipQuote(500, 0).creatorCents, 500);
  assert.deepEqual(TIP_PRESETS_CENTS, [300, 500, 1000]);
});

t('quote: the studio never keeps more than the cap from one tip (Jose, 2026-10-24: $100)', () => {
  // 5% of $2,000 is exactly the cap; above that the creator gets everything else.
  assert.deepEqual([tipQuote(200000, 5).cutCents, tipQuote(200000, 5).capped], [10000, false]);
  const big = tipQuote(500000, 5);
  assert.equal(big.cutCents, 10000);
  assert.equal(big.creatorCents, 490000);
  assert.equal(big.capped, true);
  // The cap is a setting: $0.25 makes a $10 tip hit it.
  const small = tipQuote(1000, 5, 25);
  assert.deepEqual([small.cutCents, small.creatorCents, small.capped, small.cutMaxCents], [25, 975, true, 25]);
  assert.equal(tipQuote(1000, 5, 0).cutCents, 0, 'a zero cap means the studio keeps nothing');
  assert.equal(tipQuote(1000, 5, undefined).cutCents, 50, 'no cap passed → the $100 default');
  assert.equal(tipQuote(1000, 5, 'nope').cutMaxCents, 10000, 'garbage → the default');
});

t('parse: dollars typed any which way', () => {
  assert.equal(parseTipAmount('5'), 500);
  assert.equal(parseTipAmount('$5.00'), 500);
  assert.equal(parseTipAmount(' 12.5 '), 1250);
  assert.equal(parseTipAmount('1,000'), 100000);
  assert.ok(Number.isNaN(parseTipAmount('five')));
  assert.ok(Number.isNaN(parseTipAmount('5.123')));
  assert.equal(parseTipAmount(700), 700);
});

t('validate: the minimum, the stored maximum, the note length, the name flag', () => {
  assert.equal(validateTipInput({ amountCents: 99 }).ok, false);
  assert.equal(validateTipInput({ amountCents: MIN_TIP_CENTS }).ok, true);
  assert.equal(validateTipInput({ amountCents: DEFAULT_TIP_MAX_CENTS + 1 }).ok, false);
  assert.equal(validateTipInput({ amountCents: 20000 }, { maxCents: 10000 }).ok, false);
  assert.equal(validateTipInput({ amountCents: 500.5 }).ok, false);
  const long = validateTipInput({ amountCents: 500, note: 'x'.repeat(MAX_NOTE_CHARS + 1) });
  assert.equal(long.ok, false);
  const good = validateTipInput({ amountCents: 500, note: '  the   sound design!! ', showName: 'yes' });
  assert.deepEqual(good, { ok: true, amountCents: 500, note: 'the sound design!!', showName: true });
  assert.equal(validateTipInput({ amountCents: 500, note: '   ' }).note, null);
});

t('email gap: once a day per fan', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  assert.equal(tipEmailDue(null, now), true);
  assert.equal(tipEmailDue('2026-10-24T00:00:00Z', now), false);
  assert.equal(tipEmailDue('2026-10-23T11:59:00Z', now), true);
  assert.equal(tipEmailDue('garbage', now), true);
});

t('names: only when the fan chose to show it', () => {
  assert.equal(tipperLabel({ show_name: true }, 'Anika K.'), 'Anika K.');
  assert.equal(tipperLabel({ show_name: false }, 'Anika K.'), 'A fan');
  assert.equal(tipperLabel({ show_name: true }, null), 'A fan');
});

t('return path: same-site only', () => {
  assert.equal(safeTipReturn('/profile/marareyes'), '/profile/marareyes');
  assert.equal(safeTipReturn('/episode/abc#x'), '/episode/abc');
  assert.equal(safeTipReturn('//evil.example'), '/');
  assert.equal(safeTipReturn('https://evil.example'), '/');
  assert.equal(safeTipReturn(null, '/x'), '/x');
  assert.equal(tippedState({ tipped: 'cancelled' }), 'cancelled');
  assert.equal(tippedState({ tipped: 'abc' }), 'done');
  assert.equal(tippedState({}), null);
});

console.log(`${n} passed`);
