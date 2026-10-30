// node scripts/test-screen-fill.mjs — filling the screen in full screen (lib/screenFill.js).
import assert from 'node:assert/strict';
import { cropFraction, fillsByDefault, screenFill, MAX_AUTO_CROP } from '../lib/screenFill.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const near = (a, b) => Math.abs(a - b) < 0.005;

t('the crop is the share of the picture lost when it covers the screen', () => {
  assert.equal(cropFraction(1920, 1080, 1920, 1080), 0);
  assert.ok(near(cropFraction(1920, 1080, 2556, 1179), 0.18)); // 16:9 on an iPhone 15
  assert.ok(near(cropFraction(2048, 858, 2556, 1179), 0.093)); // a 2.39:1 film on the same phone
  assert.ok(near(cropFraction(1440, 1080, 2556, 1179), 0.385)); // 4:3
  assert.ok(near(cropFraction(1920, 1080, 2048, 1536), 0.25)); // 16:9 on a 4:3 iPad
  assert.ok(near(cropFraction(1080, 1920, 2556, 1179), 0.74)); // a vertical title sideways
  assert.ok(near(cropFraction(1920, 1080, 2560, 1080), 0.25)); // an ultrawide monitor
  assert.ok(near(cropFraction(1920, 1080, 1280, 800), 0.1)); // a 16:10 laptop
});

t('unknown or broken sizes give no crop', () => {
  assert.equal(cropFraction(0, 0, 2556, 1179), null);
  assert.equal(cropFraction(1920, 1080, 0, 1179), null);
  assert.equal(cropFraction(undefined, undefined, 2556, 1179), null);
  assert.equal(cropFraction('1920', '1080', '2556', '1179') > 0, true);
});

t('fill by default only when the crop is small', () => {
  assert.equal(MAX_AUTO_CROP, 0.2);
  assert.equal(fillsByDefault(0), true);
  assert.equal(fillsByDefault(0.18), true);
  assert.equal(fillsByDefault(0.2), true);
  assert.equal(fillsByDefault(0.25), false);
  assert.equal(fillsByDefault(0.385), false);
  assert.equal(fillsByDefault(null), false);
});

t('screenFill: the rule, unless the viewer double-tapped', () => {
  const phone = { videoW: 1920, videoH: 1080, screenW: 2556, screenH: 1179 };
  assert.equal(screenFill(phone), true);
  assert.equal(screenFill({ ...phone, choice: false }), false);
  const fourThree = { videoW: 1440, videoH: 1080, screenW: 2556, screenH: 1179 };
  assert.equal(screenFill(fourThree), false);
  assert.equal(screenFill({ ...fourThree, choice: true }), true);
  assert.equal(screenFill({ ...phone, choice: null }), true);
  assert.equal(screenFill({ ...phone, choice: undefined }), true);
  assert.equal(screenFill({ videoW: 0, videoH: 0, screenW: 2556, screenH: 1179 }), false);
});

console.log(`\n${n} passed`);
