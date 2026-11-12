// node scripts/test-extra-kinds.mjs — what kind of extra a title is
// (lib/extraKinds.js, migration 121) and the app's copy
// (mobile/src/lib/extraKinds.js): the copy is checked word for word, then
// every case runs on both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/extraKinds.js';

const webSource = readFileSync(new URL('../lib/extraKinds.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/extraKinds.js', import.meta.url), 'utf8');
// mobile/package.json has no "type": "module", so the app's file is loaded
// from its source as an ES module; it imports nothing, so that works.
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

// Characters built from their code points (a source file never carries them).
const ch = (...cps) => String.fromCodePoint(...cps);

const body = (src) => src.replace(/^(?:\/\/[^\n]*\n|[ \t]*\n)*/, '');
t('the app copy is the website file word for word below its header', () => {
  assert.ok(body(webSource).startsWith('export const EXTRA_KINDS'));
  assert.equal(body(appSource), body(webSource));
  assert.deepEqual(Object.keys(app).sort(), Object.keys(web).sort());
  assert.ok(!/^\s*import\s/m.test(webSource), 'lib/extraKinds.js imports nothing');
  // Hermes (the app's engine) and old browsers: no \p{…} property escapes,
  // no lookbehind, only BMP escapes in the patterns.
  assert.doesNotMatch(webSource, /\\p\{|\(\?<[=!]/);
  // Every pattern is written with escapes, never a raw invisible character.
  for (const c of webSource) {
    const cp = c.codePointAt(0);
    assert.ok(c === '\n' || (cp >= 0x20 && cp < 0x7f) || '—…·“”‘’'.includes(c), `a raw U+${cp.toString(16)} in the source`);
  }
});

for (const [label, m] of [['web', web], ['app', app]]) {
  t(`${label}: the list is Jose's (2026-11-08), Other last and never stored`, () => {
    assert.deepEqual(m.EXTRA_KINDS.map((k) => k.label), ['Making-of', 'Behind the scenes', 'Deleted scene', 'Interview', 'Bloopers', 'Commentary', 'Teaser']);
    assert.deepEqual(m.EXTRA_KINDS.map((k) => k.id), ['making-of', 'behind-the-scenes', 'deleted-scene', 'interview', 'bloopers', 'commentary', 'teaser']);
    assert.equal(m.EXTRA_KIND_OTHER, 'other');
    assert.equal(m.EXTRA_KIND_OTHER_LABEL, 'Other');
    assert.equal(m.EXTRA_KIND_MAX, 40);
    assert.equal(m.EXTRA_KIND_WORDS.help, 'Shown on its card and its page. Leave it empty and it says Extra.');
    assert.equal(m.EXTRA_KIND_WORDS.otherLabel, 'Your category');
    assert.equal(m.normalizeExtraKind('other'), null);
  });

  t(`${label}: a preset typed any way becomes its id`, () => {
    for (const typed of ['Making-of', 'making-of', 'Making of', 'MAKING OF', 'making_of', '  making   of ', 'Making-ofs']) assert.equal(m.normalizeExtraKind(typed), 'making-of', typed);
    assert.equal(m.normalizeExtraKind('Behind the scene'), 'behind-the-scenes');
    assert.equal(m.normalizeExtraKind('behind-the-scenes'), 'behind-the-scenes');
    assert.equal(m.normalizeExtraKind('Deleted scenes'), 'deleted-scene');
    assert.equal(m.normalizeExtraKind('blooper'), 'bloopers');
    assert.equal(m.normalizeExtraKind('BLOOPERS'), 'bloopers');
    assert.equal(m.normalizeExtraKind('Interviews'), 'interview');
    assert.equal(m.normalizeExtraKind('commentary'), 'commentary');
    assert.equal(m.normalizeExtraKind('Teaser '), 'teaser');
  });

  t(`${label}: nothing, Other or Extra means no kind`, () => {
    for (const none of [null, undefined, '', '   ', 'Other', 'OTHER', 'others', 'Extra', 'extras', ch(0x200b), ch(0xfeff, 0x200e), '<>', 42, true, false, {}, [], ['Making-of'], { label: 'x' }, NaN]) {
      assert.equal(m.normalizeExtraKind(none), null, JSON.stringify(none));
      assert.equal(m.extraKindLabel(none), 'Extra');
    }
  });

  t(`${label}: their own words, cleaned`, () => {
    assert.equal(m.normalizeExtraKind('Table read'), 'Table read');
    assert.equal(m.normalizeExtraKind('  Table   read '), 'Table read');
    assert.equal(m.normalizeExtraKind('Music video\n\nfor the finale'), 'Music video for the finale');
    assert.equal(m.normalizeExtraKind('Tab\there'), 'Tab here');
    assert.equal(m.normalizeExtraKind('BTS'), 'BTS');
    assert.equal(m.normalizeExtraKind('Q&A'), 'Q&A');
    // No markup gets through, as text or otherwise.
    assert.equal(m.normalizeExtraKind('<script>alert(1)</script>'), 'scriptalert(1)/script');
    assert.equal(m.normalizeExtraKind('<b>Table</b> read'), 'bTable/b read');
    // Control, zero-width, direction and separator characters go.
    assert.equal(m.normalizeExtraKind(`a${ch(0)}b${ch(7)}c${ch(0x7f)}d${ch(0x9b)}e`), 'abcde');
    assert.equal(m.normalizeExtraKind(`Table${ch(0x200b)} read`), 'Table read');
    assert.equal(m.normalizeExtraKind(`${ch(0x202e)}daer elbaT`), 'daer elbaT');
    assert.equal(m.normalizeExtraKind(`${ch(0x2066)}x${ch(0x2069)}`), 'x');
    assert.equal(m.normalizeExtraKind(`one${ch(0x2028)}two${ch(0x2029)}three`), 'one two three');
    assert.equal(m.normalizeExtraKind(`soft${ch(0xad)}hyphen`), 'softhyphen');
    // Blank-looking fillers would print an empty label: they go, and only
    // them means no kind.
    for (const filler of [0x3164, 0x115f, 0x1160, 0x2800, 0xffa0, 0x180e]) assert.equal(m.normalizeExtraKind(ch(filler, filler)), null, filler.toString(16));
    assert.equal(m.normalizeExtraKind(`Table${ch(0x3164)} read`), 'Table read');
    // A non-breaking space is a space.
    assert.equal(m.normalizeExtraKind(`Table${ch(0xa0)}read`), 'Table read');
    // Accents stay; stacked combining marks are capped at two.
    assert.equal(m.normalizeExtraKind('Café crème'), 'Café crème');
    assert.equal(m.normalizeExtraKind(`Cafe${ch(0x301)} cre${ch(0x300)}me`), `Cafe${ch(0x301)} cre${ch(0x300)}me`);
    const zalgo = `Z${ch(0x301, 0x302, 0x303, 0x304, 0x305, 0x306)}a`;
    assert.equal(m.normalizeExtraKind(zalgo), `Z${ch(0x301, 0x302)}a`);
    // Other scripts and emoji are words like any other.
    assert.equal(m.normalizeExtraKind('Entrevista con el director'), 'Entrevista con el director');
    assert.equal(m.normalizeExtraKind('メイキング'), 'メイキング');
    assert.equal(m.normalizeExtraKind(`${ch(0x1f3ac)} Table read`), `${ch(0x1f3ac)} Table read`);
  });

  t(`${label}: a lone surrogate is dropped (Postgres can't store one; it answered 500)`, () => {
    const hi = String.fromCharCode(0xd800);
    const lo = String.fromCharCode(0xdc00);
    assert.equal(m.normalizeExtraKind(`ab${hi}cd`), 'abcd');
    assert.equal(m.normalizeExtraKind(`ab${lo}cd`), 'abcd');
    assert.equal(m.normalizeExtraKind(`${lo}${hi}`), null, 'nothing left');
    assert.equal(m.normalizeExtraKind(`Table read${hi}`), 'Table read', 'at the end');
    assert.equal(m.normalizeExtraKind(`${ch(0x1f3ac)} Take ${hi}2`), `${ch(0x1f3ac)} Take 2`, 'a real pair stays');
    assert.equal(m.dropLoneSurrogates(`a${hi}${hi}${ch(0x1f3ac)}${lo}b`), `a${ch(0x1f3ac)}b`);
    assert.ok(m.normalizeExtraKind(`x${hi}`.repeat(30)).isWellFormed(), 'what comes out is well formed');
  });

  t(`${label}: 40 characters at most, counted as Postgres counts them`, () => {
    assert.equal(m.normalizeExtraKind('x'.repeat(40)), 'x'.repeat(40));
    assert.equal(m.normalizeExtraKind('x'.repeat(41)), 'x'.repeat(40));
    assert.equal(m.normalizeExtraKind('y'.repeat(500)).length, 40);
    // A cut that lands on a space doesn't keep it.
    assert.equal(m.normalizeExtraKind(`${'a'.repeat(39)} b`), 'a'.repeat(39));
    // An emoji is one character (never half of one).
    const film = ch(0x1f3ac);
    const out = m.normalizeExtraKind(film.repeat(60));
    assert.equal(Array.from(out).length, 40);
    assert.equal(out, film.repeat(40));
  });

  t(`${label}: the label a card and the page print`, () => {
    assert.equal(m.extraKindLabel('making-of'), 'Making-of');
    assert.equal(m.extraKindLabel('behind-the-scenes'), 'Behind the scenes');
    assert.equal(m.extraKindLabel('deleted-scene'), 'Deleted scene');
    assert.equal(m.extraKindLabel('interview'), 'Interview');
    assert.equal(m.extraKindLabel('bloopers'), 'Bloopers');
    assert.equal(m.extraKindLabel('commentary'), 'Commentary');
    assert.equal(m.extraKindLabel('teaser'), 'Teaser');
    assert.equal(m.extraKindLabel('Table read'), 'Table read');
    assert.equal(m.extraKindLabel(null), 'Extra');
    // A stored value written by hand is cleaned on the way out too.
    assert.equal(m.extraKindLabel('  Making of '), 'Making-of');
    assert.equal(m.extraKindLabel(`<i>${'z'.repeat(60)}`), `i${'z'.repeat(39)}`);
    assert.equal(m.extraMetaLine('making-of', '6 min'), 'Making-of · 6 min');
    assert.equal(m.extraMetaLine('Table read', '4 min'), 'Table read · 4 min');
    assert.equal(m.extraMetaLine(null, '6 min'), 'Extra · 6 min');
    assert.equal(m.extraMetaLine(null, null), 'Extra');
    assert.equal(m.extraMetaLine('teaser', ''), 'Teaser');
  });

  t(`${label}: a kind as a field and back`, () => {
    assert.deepEqual(m.extraKindChoice(null), { choice: '', other: '' });
    assert.deepEqual(m.extraKindChoice('making-of'), { choice: 'making-of', other: '' });
    assert.deepEqual(m.extraKindChoice('Table read'), { choice: 'other', other: 'Table read' });
    assert.deepEqual(m.extraKindChoice('Making of'), { choice: 'making-of', other: '' });
    assert.equal(m.extraKindFromChoice('', ''), null);
    assert.equal(m.extraKindFromChoice('teaser', 'ignored'), 'teaser');
    assert.equal(m.extraKindFromChoice('other', ''), null, 'Other left empty keeps the word Extra');
    assert.equal(m.extraKindFromChoice('other', '   '), null);
    assert.equal(m.extraKindFromChoice('other', ' Table  read '), 'Table read');
    // Typing a preset's name into Other picks the preset.
    assert.equal(m.extraKindFromChoice('other', 'interview'), 'interview');
    assert.equal(m.extraKindFromChoice('not-a-kind', 'x'), null);
    assert.equal(m.extraKindFromChoice('__proto__', ''), null);
    assert.equal(m.isPresetExtraKind('teaser'), true);
    assert.equal(m.isPresetExtraKind('Teaser'), false);
    assert.equal(m.isPresetExtraKind('constructor'), false);
    assert.equal(m.isPresetExtraKind(null), false);
    // Round trip: every stored value comes back as itself.
    for (const stored of ['making-of', 'teaser', 'Table read', 'Music video', null]) {
      const f = m.extraKindChoice(stored);
      assert.equal(m.extraKindFromChoice(f.choice, f.other), stored);
    }
  });

  t(`${label}: normalizing is idempotent`, () => {
    for (const x of ['Making of', ' Table   read ', `Z${ch(0x301, 0x302, 0x303)}`, 'q'.repeat(90), `${ch(0x1f3ac)}`.repeat(50), '<x>y']) {
      const once = m.normalizeExtraKind(x);
      assert.equal(m.normalizeExtraKind(once), once, x);
    }
  });
}

console.log(`\n${n} passed`);
