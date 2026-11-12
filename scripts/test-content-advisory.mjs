// node scripts/test-content-advisory.mjs — the card over the first seconds
// of playback: the rating advisory (lib/contentAdvisory.js advisoryFor,
// Jose 2026-10-20) and the flashing-lights warning (2026-11-12:
// flashingLightsFor, playbackAdvisoryFor — one card carrying both, the
// video held at its first frame under the warning). Runs every case on the
// website's copy and the app's (mobile/src/lib/contentAdvisory.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// lib/contentAdvisory.js imports './ageGate' without an extension (the
// bundler resolves it); Node's ESM loader doesn't, so the source is loaded
// with that one import pointed at the real file (scripts/test-crew-pay.mjs).
const webSource = readFileSync(new URL('../lib/contentAdvisory.js', import.meta.url), 'utf8').replace("from './ageGate'", `from '${new URL('../lib/ageGate.js', import.meta.url).href}'`);
const web = await import(`data:text/javascript;base64,${Buffer.from(webSource).toString('base64')}`);

// The app's file imports React and the API helper for its ratings hook;
// the rules below never touch them, so the test loads the file without
// its import lines (mobile/package.json has no "type": "module").
const appSource = readFileSync(new URL('../mobile/src/lib/contentAdvisory.js', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*import\s/.test(line))
  .join('\n');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

const RATINGS = [
  { code: 'TV-MA', label: 'Mature audiences only', minAge: 17, imageUrl: 'https://example.test/tvma.png' },
  { code: 'TV-14', label: 'Parents strongly cautioned', minAge: 14, imageUrl: null },
  { code: 'G', label: 'General audiences', minAge: 0, imageUrl: null }
];

let n = 0;
function suite(name, L) {
  const t = (what, fn) => { fn(); n += 1; console.log(`ok [${name}] ${what}`); };

  t('the rating advisory is unchanged: a series always, a film at 13+', () => {
    assert.equal(L.advisoryFor({ contentType: 'movie', rating: 'G' }, RATINGS), null);
    const series = L.advisoryFor({ contentType: 'series', rating: 'G' }, RATINGS);
    assert.equal(series.level, 'all');
    assert.equal(series.line, null);
    const film = L.advisoryFor({ contentType: 'movie', rating: 'TV-MA' }, RATINGS);
    assert.equal(film.level, 'mature');
    assert.equal(film.imageUrl, 'https://example.test/tvma.png');
    assert.equal(film.line, 'Viewer discretion is advised.');
    assert.equal(L.advisoryFor({ rating: null, contentType: null }, RATINGS), null, 'a lesson');
  });

  t('flashingLightsFor: only a title marked with flashing lights', () => {
    assert.equal(L.flashingLightsFor(null), null);
    assert.equal(L.flashingLightsFor({}), null);
    assert.equal(L.flashingLightsFor({ hasFlashingLights: false }), null);
    assert.equal(L.flashingLightsFor({ hasFlashingLights: 'yes' }), null, 'only a real true');
    assert.deepEqual(L.flashingLightsFor({ hasFlashingLights: true }), {
      kicker: 'WARNING',
      headline: 'This program contains flashing lights that may affect viewers with photosensitive epilepsy.',
      line: 'Viewer discretion is advised.'
    });
    assert.equal(L.FLASHING_CHIP, 'Flashing lights');
  });

  t('playbackAdvisoryFor: nothing to say → null', () => {
    assert.equal(L.playbackAdvisoryFor(null, RATINGS), null);
    assert.equal(L.playbackAdvisoryFor({ contentType: 'movie', rating: 'G' }, RATINGS), null);
    assert.equal(L.playbackAdvisoryFor({ contentType: 'movie', rating: 'G', hasFlashingLights: false }, RATINGS), null);
  });

  t('playbackAdvisoryFor: the rating alone does not hold the video', () => {
    const card = L.playbackAdvisoryFor({ contentType: 'movie', rating: 'TV-14' }, RATINGS);
    assert.equal(card.holds, false);
    assert.equal(card.flashing, null);
    assert.equal(card.rating.code, 'TV-14');
    assert.equal(card.rating.line, 'Viewer discretion is advised.');
    assert.equal(card.label, 'Rated TV-14. This program may not be suitable for younger viewers. Viewer discretion is advised.');
  });

  t('playbackAdvisoryFor: the warning alone holds the video (a G film has no rating card)', () => {
    const card = L.playbackAdvisoryFor({ contentType: 'movie', rating: 'G', hasFlashingLights: true }, RATINGS);
    assert.equal(card.rating, null);
    assert.equal(card.holds, true);
    assert.equal(card.flashing.kicker, 'WARNING');
    assert.equal(card.label, 'Warning. This program contains flashing lights that may affect viewers with photosensitive epilepsy. Viewer discretion is advised.');
  });

  t('playbackAdvisoryFor: both on ONE card, the discretion line said once', () => {
    const card = L.playbackAdvisoryFor({ contentType: 'movie', rating: 'TV-MA', hasFlashingLights: true }, RATINGS);
    assert.equal(card.holds, true);
    assert.equal(card.rating.code, 'TV-MA');
    assert.equal(card.rating.imageUrl, 'https://example.test/tvma.png');
    assert.equal(card.rating.headline, 'This program contains mature content.');
    assert.equal(card.rating.line, null, 'the warning carries it');
    assert.equal(card.flashing.line, 'Viewer discretion is advised.');
    assert.equal((card.label.match(/Viewer discretion is advised\./g) || []).length, 1);
    assert.ok(card.label.startsWith('Rated TV-MA. This program contains mature content. Warning.'));
  });

  t('playbackAdvisoryFor: a series rated for everyone with flashing lights', () => {
    const card = L.playbackAdvisoryFor({ contentType: 'series', rating: 'G', hasFlashingLights: true }, RATINGS);
    assert.equal(card.rating.level, 'all');
    assert.equal(card.rating.line, null);
    assert.equal(card.holds, true);
  });

  t('an unrated film keeps its 17+ advisory beside the warning', () => {
    const card = L.playbackAdvisoryFor({ contentType: 'short', rating: null, hasFlashingLights: true }, RATINGS);
    assert.equal(card.rating.code, 'Not Rated');
    assert.equal(card.rating.kicker, 'Not yet rated · treated as 17+');
    assert.equal(card.holds, true);
  });
}

suite('web', web);
suite('app', app);

// The words are the same on both sides.
for (const k of ['FLASHING_KICKER', 'FLASHING_HEADLINE', 'DISCRETION_LINE', 'FLASHING_CHIP', 'ADVISORY_MS']) {
  assert.equal(web[k], app[k], k);
}
n += 1;
console.log('ok the website and the app share the words');

console.log(`\n${n} content-advisory checks passed`);
