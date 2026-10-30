// node scripts/test-fullscreen-chrome.mjs — the app's full-screen chrome: its scale and its edges (lib/fullscreenChromeRules.js).
import assert from 'node:assert/strict';
import { chromeScale, fullscreenPadding, GUTTER, MAX_SCALE, MIN_SCALE } from '../lib/fullscreenChromeRules.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the scale follows the short side, 1 on an iPhone 15, capped at one and a half', () => {
  assert.equal(chromeScale(393), MIN_SCALE); // iPhone 15, the phone the sizes are drawn for
  assert.equal(chromeScale(375), MIN_SCALE); // iPhone SE keeps the phone sizes
  assert.ok(Math.abs(chromeScale(430) - 1.094) < 0.01); // iPhone 15 Pro Max
  assert.ok(Math.abs(chromeScale(412) - 1.048) < 0.01); // Pixel 8
  assert.equal(chromeScale(744), MAX_SCALE); // iPad mini
  assert.equal(chromeScale(1024), MAX_SCALE); // iPad Pro 12.9
  assert.equal(chromeScale(0), MIN_SCALE);
  assert.equal(chromeScale(undefined), MIN_SCALE);
});

t('an iPhone sideways: a 16pt gutter at the sides, the home indicator at the bottom, nothing at the top', () => {
  const p = fullscreenPadding({ platform: 'ios', scale: 1, insets: { top: 0, bottom: 21, left: 59, right: 59 } });
  assert.deepEqual(p, { gutter: GUTTER, left: 16, right: 16, top: 0, bottom: 21 });
});

t('an iPhone upright (a vertical title): the notch at the top, the indicator at the bottom', () => {
  const p = fullscreenPadding({ platform: 'ios', scale: 1, insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  assert.deepEqual(p, { gutter: 16, left: 16, right: 16, top: 59, bottom: 34 });
});

t('an iPad scales the gutter with the chrome', () => {
  const p = fullscreenPadding({ platform: 'ios', scale: 1.5, insets: { top: 0, bottom: 20, left: 0, right: 0 } });
  assert.deepEqual(p, { gutter: 24, left: 24, right: 24, top: 0, bottom: 20 });
});

t('Android: a cutout at the side wins over the gutter, otherwise the gutter', () => {
  const cut = fullscreenPadding({ platform: 'android', scale: 1, insets: { top: 0, bottom: 0, left: 30, right: 0 } });
  assert.deepEqual(cut, { gutter: 16, left: 30, right: 16, top: 0, bottom: 0 });
  const plain = fullscreenPadding({ platform: 'android', scale: 1.056, insets: { top: 0, bottom: 24, left: 0, right: 0 } });
  assert.deepEqual(plain, { gutter: 17, left: 17, right: 17, top: 0, bottom: 24 });
});

t('missing or broken insets read as none', () => {
  assert.deepEqual(fullscreenPadding({ platform: 'ios', scale: 1 }), { gutter: 16, left: 16, right: 16, top: 0, bottom: 0 });
  assert.deepEqual(fullscreenPadding({ platform: 'ios', scale: 1, insets: { top: NaN, bottom: -3, left: 'x', right: null } }), { gutter: 16, left: 16, right: 16, top: 0, bottom: 0 });
});

console.log(`\n${n} passed`);
