// node scripts/test-tab-bar-fit.mjs — how the app's bottom bar fits its
// labels (mobile/src/lib/tabBarFit.js, 2026-11-14: the Dashboard tab makes
// five tabs for a creator and six for an admin). A viewer's bar is as it
// always was; with the Dashboard every label stays on one line inside its
// own tab on any phone, and the size only comes down when nothing else is
// left to give.
import assert from 'node:assert/strict';
import { tabBarFit, tabWidths, labelWidth, LABEL_SIZE, LABEL_SPACING, TIGHT_SPACING, LEAST_SIZE, LONG_SHARE } from '../mobile/src/lib/tabBarFit.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

const tab = (text, caret, long = false) => ({ text, caret, long });
const VIEWER = [tab('Home', true), tab('Discover', false), tab('Watch', true), tab('Account', true)];
const CREATOR = [tab('Home', true), tab('Discover', false), tab('Watch', true), tab('Dashboard', false, true), tab('Account', true)];
const ADMIN = [...CREATOR, tab('Admin', true)];
// The bar is the screen less 16pt a side (BottomNav).
const bar = (screen) => screen - 32;
// Every label inside its own tab, with at least the squarer pill's air.
const inside = (fit, tabs, barWidth) => {
  const widths = tabWidths(barWidth, tabs, fit.share);
  return tabs.every((x, i) => labelWidth(x, fit.size, fit.spacing, fit.carets) <= widths[i] - 5.5 + 1e-9);
};

t('a viewer’s four tabs are as they always were, on any phone', () => {
  for (const screen of [320, 360, 390, 430]) {
    assert.deepEqual(tabBarFit({ barWidth: bar(screen), tabs: VIEWER }), { size: LABEL_SIZE, spacing: LABEL_SPACING, carets: true, round: true, share: 1 }, `${screen}`);
  }
});

t('a creator’s five and an admin’s six fit on every phone', () => {
  for (const [who, tabs] of [['creator', CREATOR], ['admin', ADMIN]]) {
    for (const screen of [320, 344, 360, 375, 390, 412, 430]) {
      const fit = tabBarFit({ barWidth: bar(screen), tabs });
      assert.ok(inside(fit, tabs, bar(screen)), `${who} at ${screen}: ${JSON.stringify(fit)}`);
      assert.ok(fit.size >= LEAST_SIZE && fit.size <= LABEL_SIZE, `${who} at ${screen}: size ${fit.size}`);
    }
  }
});

t('the bar gives way a step at a time: spacing, then the pill, then the carets, and the size last', () => {
  const sizes = [];
  for (const screen of [430, 412, 390, 375, 360, 344, 320]) {
    const fit = tabBarFit({ barWidth: bar(screen), tabs: ADMIN });
    sizes.push(fit.size);
    // The size is only touched once the spacing is tight, the pill squarer and the carets gone.
    if (fit.size < LABEL_SIZE) assert.deepEqual({ spacing: fit.spacing, carets: fit.carets, round: fit.round, share: fit.share }, { spacing: TIGHT_SPACING, carets: false, round: false, share: LONG_SHARE }, `${screen}`);
    if (!fit.carets) assert.equal(fit.round, false);
    if (!fit.round) assert.equal(fit.spacing, TIGHT_SPACING);
  }
  // A narrower phone never gets a larger label.
  assert.ok(sizes.every((s, i) => i === 0 || s <= sizes[i - 1]), sizes.join(' '));
  // A creator's five keep the full size on every phone; an admin's six do
  // down to 360pt, and on a 320pt phone the labels are still 7.3pt.
  for (const screen of [320, 360, 390]) assert.equal(tabBarFit({ barWidth: bar(screen), tabs: CREATOR }).size, LABEL_SIZE);
  assert.equal(tabBarFit({ barWidth: bar(360), tabs: ADMIN }).size, LABEL_SIZE);
  assert.equal(tabBarFit({ barWidth: bar(320), tabs: ADMIN }).size, 7.3);
});

t('the phone’s text size moves the labels only as far as they still fit', () => {
  const big = tabBarFit({ barWidth: bar(430), tabs: VIEWER, fontScale: 1.3 });
  assert.equal(big.size, 10.8);
  assert.ok(inside(big, VIEWER, bar(430)));
  const huge = tabBarFit({ barWidth: bar(430), tabs: VIEWER, fontScale: 3 });
  assert.equal(huge.size, 10.8);
  const tight = tabBarFit({ barWidth: bar(320), tabs: ADMIN, fontScale: 1.3 });
  assert.ok(inside(tight, ADMIN, bar(320)), JSON.stringify(tight));
  const small = tabBarFit({ barWidth: bar(390), tabs: VIEWER, fontScale: 0.5 });
  assert.equal(small.size, 7.1);
});

t('nothing to fit, or no width yet: the bar as it always was', () => {
  assert.deepEqual(tabBarFit({ barWidth: 0, tabs: ADMIN }), { size: LABEL_SIZE, spacing: LABEL_SPACING, carets: true, round: true, share: 1 });
  assert.deepEqual(tabBarFit({ barWidth: 358, tabs: [] }), { size: LABEL_SIZE, spacing: LABEL_SPACING, carets: true, round: true, share: 1 });
});

console.log(`${n} passed`);
