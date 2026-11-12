// node scripts/test-well-formed.mjs — request text made well formed
// before it is stored (lib/wellFormed.js): a lone surrogate, which
// Postgres refuses (a save carrying one answered 500), becomes U+FFFD; a
// real pair stays; a parsed body is cleaned in place, keys included, with
// nothing written through a "__proto__" key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPLACEMENT_CHAR, wellFormed, wellFormedBody, wellFormedDeep } from '../lib/wellFormed.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const hi = String.fromCharCode(0xd800);
const lo = String.fromCharCode(0xdc00);
const pair = String.fromCodePoint(0x1f3ac);
const R = REPLACEMENT_CHAR;

t('imports nothing (client-safe)', () => {
  assert.ok(!/^\s*import\s/m.test(readFileSync(new URL('../lib/wellFormed.js', import.meta.url), 'utf8')));
});

t('a lone surrogate becomes U+FFFD; a real pair stays', () => {
  assert.equal(wellFormed(`ab${hi}cd`), `ab${R}cd`);
  assert.equal(wellFormed(`ab${lo}cd`), `ab${R}cd`);
  assert.equal(wellFormed(`${lo}${hi}`), `${R}${R}`);
  assert.equal(wellFormed(`x${pair}y`), `x${pair}y`);
  assert.equal(wellFormed(`${hi}${pair}${lo}`), `${R}${pair}${R}`);
  assert.equal(wellFormed('plain'), 'plain');
  assert.equal(wellFormed(''), '');
  assert.ok(wellFormed(`ab${hi}`).isWellFormed());
});

t('what isn’t a string comes back as it is', () => {
  assert.equal(wellFormed(null), null);
  assert.equal(wellFormed(undefined), undefined);
  assert.equal(wellFormed(42), 42);
  assert.equal(wellFormed(true), true);
  const o = {};
  assert.equal(wellFormed(o), o);
});

t('the same rule without String.prototype.toWellFormed (an older engine)', () => {
  const saved = [String.prototype.isWellFormed, String.prototype.toWellFormed];
  delete String.prototype.isWellFormed;
  delete String.prototype.toWellFormed;
  try {
    assert.equal(wellFormed(`ab${hi}cd${lo}${pair}`), `ab${R}cd${R}${pair}`);
  } finally {
    // eslint-disable-next-line no-extend-native
    String.prototype.isWellFormed = saved[0];
    // eslint-disable-next-line no-extend-native
    String.prototype.toWellFormed = saved[1];
  }
});

t('a parsed body: every string, nested, in place; keys too', () => {
  const body = JSON.parse('{"extraKind":"ab\\ud800cd","pageNotes":"n\\udc00","form":{"title":"T\\ud800","list":["a\\ud800",1,null,{"deep":"\\udc00"}]},"ok":true,"k\\ud800":"v"}');
  const same = wellFormedDeep(body);
  assert.equal(same, body, 'cleaned in place');
  assert.equal(body.extraKind, `ab${R}cd`);
  assert.equal(body.pageNotes, `n${R}`);
  assert.equal(body.form.title, `T${R}`);
  assert.deepEqual(body.form.list, [`a${R}`, 1, null, { deep: R }]);
  assert.equal(body.ok, true);
  assert.equal(body[`k${R}`], 'v');
  assert.ok(!Object.keys(body).some((k) => !k.isWellFormed()));
  assert.ok(JSON.stringify(body).isWellFormed());
});

t('an own "__proto__" key in a body never sets the prototype', () => {
  const body = JSON.parse('{"__proto__":{"polluted":"x\\ud800"},"a":"b"}');
  wellFormedDeep(body);
  assert.equal(Object.getPrototypeOf(body), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(body, '__proto__').value.polluted, `x${R}`);
});

t('wellFormedBody cleans req.body and leaves a missing body alone', () => {
  const req = { body: { title: `x${hi}` } };
  assert.deepEqual(wellFormedBody(req), { title: `x${R}` });
  assert.equal(req.body.title, `x${R}`);
  assert.equal(wellFormedBody({ body: undefined }), undefined);
  assert.equal(wellFormedBody({ body: null }), null);
  assert.equal(wellFormedBody(null), undefined);
  const s = { body: `raw${lo}` };
  assert.equal(wellFormedBody(s), `raw${R}`);
});

t('a very deep body stops at the depth cap instead of recursing for ever', () => {
  let deep = { v: `x${hi}` };
  for (let i = 0; i < 100; i += 1) deep = { d: deep };
  assert.doesNotThrow(() => wellFormedDeep(deep));
});

console.log(`\n${n} well-formed checks passed`);
