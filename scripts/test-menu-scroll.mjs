// node scripts/test-menu-scroll.mjs — a menu is its own scroll area
// (lib/menuScroll.js, 2026-11-14) and the app's copy
// (mobile/src/lib/menuScroll.js): the copy is checked word for word, then
// the room a panel gets, and what a wheel or a finger does on a panel,
// against a stand-in element.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../lib/menuScroll.js';

const webSource = readFileSync(new URL('../lib/menuScroll.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../mobile/src/lib/menuScroll.js', import.meta.url), 'utf8');
const app = await import(`data:text/javascript;base64,${Buffer.from(appSource).toString('base64')}`);

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };

t('the app copy is the website file word for word', () => {
  assert.equal(appSource, webSource);
});

for (const [label, m] of [['web', web], ['app', app]]) {
  const { panelRoom, riseRoom, scrollSpent, PANEL_LEAST, PANEL_GAP, PANEL_TAB_GAP } = m;

  t(`${label}: a panel gets the screen below the bar, less a gap`, () => {
    // Jose's tablet, sideways: the bar ends at 180, the screen at 695.
    assert.equal(panelRoom({ top: 180, viewBottom: 695 }), 695 - PANEL_GAP - 180);
    // A laptop.
    assert.equal(panelRoom({ top: 76, viewBottom: 800 }), 800 - PANEL_GAP - 76);
  });

  t(`${label}: it stops above the phone's tab bar`, () => {
    // A phone: bar to 96, screen 844, tab bar from 762.
    assert.equal(panelRoom({ top: 96, viewBottom: 844, floor: 762 }), 762 - PANEL_TAB_GAP - 96);
    // The same phone sideways.
    assert.equal(panelRoom({ top: 70, viewBottom: 390, floor: 287 }), 287 - PANEL_TAB_GAP - 70);
  });

  t(`${label}: a floor above the panel's own top is not a floor (the rail, a bar scrolled away)`, () => {
    assert.equal(panelRoom({ top: 96, viewBottom: 844, floor: 40 }), 844 - PANEL_GAP - 96);
    assert.equal(panelRoom({ top: 96, viewBottom: 844, floor: null }), 844 - PANEL_GAP - 96);
    assert.equal(panelRoom({ top: 96, viewBottom: 844, floor: undefined }), 844 - PANEL_GAP - 96);
  });

  t(`${label}: never less than a few rows, never a nonsense number`, () => {
    assert.equal(panelRoom({ top: 300, viewBottom: 320 }), PANEL_LEAST);
    assert.equal(panelRoom({ top: 500, viewBottom: 320 }), PANEL_LEAST);
    assert.equal(panelRoom({ top: NaN, viewBottom: 800 }), PANEL_LEAST);
    assert.equal(panelRoom({ top: 80, viewBottom: undefined }), PANEL_LEAST);
    assert.equal(panelRoom(), PANEL_LEAST);
    assert.equal(panelRoom({ top: 80.4, viewBottom: 700.9 }), Math.floor(700.9 - PANEL_GAP - 80.4));
  });

  t(`${label}: a menu rising from the tab bar has the room up to the header`, () => {
    // A phone upright: the bar's menu may rise from 752 to the header at 96.
    assert.equal(riseRoom({ bottom: 752, ceiling: 96 }), 752 - 96 - PANEL_GAP);
    // No header on screen: to the top of the screen.
    assert.equal(riseRoom({ bottom: 752 }), 752 - PANEL_GAP);
    assert.equal(riseRoom({ bottom: 752, ceiling: -300 }), 752 - PANEL_GAP);
    // Sideways there is little: a few rows, scrolling.
    assert.equal(riseRoom({ bottom: 277, ceiling: 70 }), 277 - 70 - PANEL_GAP);
    assert.equal(riseRoom({ bottom: 120, ceiling: 70 }), PANEL_LEAST);
    assert.equal(riseRoom({ bottom: NaN }), PANEL_LEAST);
    assert.equal(riseRoom(), PANEL_LEAST);
  });

  t(`${label}: a scroll is spent when the list has nowhere to go that way`, () => {
    // Nothing to scroll at all.
    assert.equal(scrollSpent({ scrollTop: 0, max: 0, goingDown: true }), true);
    assert.equal(scrollSpent({ scrollTop: 0, max: 1, goingDown: false }), true);
    // At the top: up is spent, down is not.
    assert.equal(scrollSpent({ scrollTop: 0, max: 300, goingDown: false }), true);
    assert.equal(scrollSpent({ scrollTop: 0, max: 300, goingDown: true }), false);
    // In the middle: neither.
    assert.equal(scrollSpent({ scrollTop: 120, max: 300, goingDown: false }), false);
    assert.equal(scrollSpent({ scrollTop: 120, max: 300, goingDown: true }), false);
    // At the bottom (a half pixel short counts): down is spent.
    assert.equal(scrollSpent({ scrollTop: 299.5, max: 300, goingDown: true }), true);
    assert.equal(scrollSpent({ scrollTop: 300, max: 300, goingDown: false }), false);
  });
}

// keepScrollInside against a stand-in element.
function fakePanel({ scrollHeight, clientHeight, scrollTop = 0 }) {
  const handlers = {};
  return {
    scrollHeight, clientHeight, scrollTop,
    addEventListener(type, fn, opts) { handlers[type] = { fn, opts }; },
    removeEventListener(type, fn) { if (handlers[type] && handlers[type].fn === fn) delete handlers[type]; },
    fire(type, event) { if (handlers[type]) handlers[type].fn(event); return event; },
    handlers
  };
}
const ev = (extra = {}) => ({ cancelable: true, prevented: false, preventDefault() { this.prevented = true; }, ...extra });
const touch = (y) => ({ touches: [{ clientY: y }] });

t('wheel: listened to as cancellable, touchmove too, touchstart passive', () => {
  const p = fakePanel({ scrollHeight: 900, clientHeight: 400 });
  web.keepScrollInside(p);
  assert.equal(p.handlers.wheel.opts.passive, false);
  assert.equal(p.handlers.touchmove.opts.passive, false);
  assert.equal(p.handlers.touchstart.opts.passive, true);
});

t('wheel: a list with room scrolls; at either end the page behind does not', () => {
  const p = fakePanel({ scrollHeight: 900, clientHeight: 400, scrollTop: 0 });
  web.keepScrollInside(p);
  assert.equal(p.fire('wheel', ev({ deltaY: 40, deltaX: 0 })).prevented, false, 'down from the top scrolls the list');
  assert.equal(p.fire('wheel', ev({ deltaY: -40, deltaX: 0 })).prevented, true, 'up at the top is cancelled');
  p.scrollTop = 500;
  assert.equal(p.fire('wheel', ev({ deltaY: 40, deltaX: 0 })).prevented, true, 'down at the bottom is cancelled');
  assert.equal(p.fire('wheel', ev({ deltaY: -40, deltaX: 0 })).prevented, false, 'up from the bottom scrolls the list');
});

t('wheel: a short list cancels both ways; a sideways wheel, a zoom and an uncancellable one pass', () => {
  const p = fakePanel({ scrollHeight: 300, clientHeight: 300 });
  web.keepScrollInside(p);
  assert.equal(p.fire('wheel', ev({ deltaY: 40, deltaX: 0 })).prevented, true);
  assert.equal(p.fire('wheel', ev({ deltaY: -40, deltaX: 0 })).prevented, true);
  assert.equal(p.fire('wheel', ev({ deltaY: 4, deltaX: 60 })).prevented, false);
  assert.equal(p.fire('wheel', ev({ deltaY: 40, deltaX: 0, ctrlKey: true })).prevented, false);
  assert.equal(p.fire('wheel', ev({ deltaY: 0, deltaX: 0 })).prevented, false);
  assert.equal(p.fire('wheel', ev({ deltaY: 40, deltaX: 0, cancelable: false })).prevented, false);
});

t('touch: a finger moving up scrolls the list down; at the ends the page stays', () => {
  const p = fakePanel({ scrollHeight: 900, clientHeight: 400, scrollTop: 0 });
  web.keepScrollInside(p);
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(260))).prevented, false, 'finger up at the top: the list scrolls');
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(340))).prevented, true, 'finger down at the top: cancelled');
  p.scrollTop = 500;
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(260))).prevented, true, 'finger up at the bottom: cancelled');
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(340))).prevented, false, 'finger down at the bottom: the list scrolls');
});

t('touch: a tap, two fingers and a move with no start are left alone', () => {
  const p = fakePanel({ scrollHeight: 300, clientHeight: 300 });
  web.keepScrollInside(p);
  assert.equal(p.fire('touchmove', ev(touch(340))).prevented, false, 'no start seen');
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(301))).prevented, false, 'a tap that wobbles a pixel');
  assert.equal(p.fire('touchmove', ev({ touches: [{ clientY: 200 }, { clientY: 400 }] })).prevented, false, 'a pinch');
  p.fire('touchstart', { touches: [{ clientY: 200 }, { clientY: 400 }] });
  assert.equal(p.fire('touchmove', ev(touch(100))).prevented, false, 'a pinch that lifted one finger');
  p.fire('touchstart', touch(300));
  assert.equal(p.fire('touchmove', ev(touch(250))).prevented, true, 'a real drag on a list with nothing to scroll');
});

// A dialog: the backdrop is the panel, the fields scroll in a box inside
// it, and a tall text box scrolls inside that.
function dialog() {
  const backdrop = fakePanel({ scrollHeight: 800, clientHeight: 800 });
  const card = { scrollHeight: 900, clientHeight: 700, scrollTop: 0, overflowY: 'hidden', parentElement: backdrop };
  const body = { scrollHeight: 1400, clientHeight: 500, scrollTop: 0, overflowY: 'auto', parentElement: card };
  const field = { scrollHeight: 46, clientHeight: 46, scrollTop: 0, overflowY: 'visible', parentElement: body };
  const area = { scrollHeight: 300, clientHeight: 120, scrollTop: 0, overflowY: 'auto', parentElement: body };
  const all = [card, body, field, area];
  backdrop.contains = (el) => all.includes(el);
  return { backdrop, card, body, field, area, overflowOf: (el) => el.overflowY };
}

t('a dialog: a wheel on a field scrolls the box of fields, and at its end nothing behind', () => {
  const d = dialog();
  web.keepScrollInside(d.backdrop, { overflowOf: d.overflowOf });
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.field })).prevented, false, 'the body has room');
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: -40, deltaX: 0, target: d.field })).prevented, true, 'the body is at its top');
  d.body.scrollTop = 900;
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.field })).prevented, true, 'the body is at its end');
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: -40, deltaX: 0, target: d.field })).prevented, false);
});

t('a dialog: a box that hides its overflow is not a scroll area; the backdrop outside the card cancels', () => {
  const d = dialog();
  web.keepScrollInside(d.backdrop, { overflowOf: d.overflowOf });
  // The card has more content than height but overflow: hidden.
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.card })).prevented, true);
  // On the backdrop itself (outside the card), and with no target at all.
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.backdrop })).prevented, true);
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0 })).prevented, true);
  // Something that isn't in the dialog at all counts as the backdrop.
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: { scrollHeight: 9000, clientHeight: 100, scrollTop: 0, overflowY: 'auto' } })).prevented, true);
});

t('a dialog: a tall text box scrolls itself first, then the fields, then nothing', () => {
  const d = dialog();
  web.keepScrollInside(d.backdrop, { overflowOf: d.overflowOf });
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.area })).prevented, false, 'the text box has room');
  d.area.scrollTop = 180;
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.area })).prevented, false, 'the fields carry on');
  d.body.scrollTop = 900;
  assert.equal(d.backdrop.fire('wheel', ev({ deltaY: 40, deltaX: 0, target: d.area })).prevented, true, 'nothing left');
  // A finger: the same, by direction.
  d.backdrop.fire('touchstart', touch(300));
  assert.equal(d.backdrop.fire('touchmove', ev({ ...touch(250), target: d.area })).prevented, true, 'finger up at every end');
  d.backdrop.fire('touchstart', touch(300));
  assert.equal(d.backdrop.fire('touchmove', ev({ ...touch(350), target: d.area })).prevented, false, 'finger down: the text box scrolls back');
});

t('roomInside: the panel counts whatever its own overflow says', () => {
  const p = { scrollHeight: 900, clientHeight: 400, scrollTop: 0 };
  assert.equal(web.roomInside(null, p, true, () => 'visible'), true);
  assert.equal(web.roomInside(null, p, false, () => 'visible'), false);
  assert.equal(web.roomInside(undefined, { scrollHeight: 100, clientHeight: 100, scrollTop: 0 }, true), false);
});

t('letting go removes every listener; a missing panel is harmless', () => {
  const p = fakePanel({ scrollHeight: 900, clientHeight: 400 });
  const release = web.keepScrollInside(p);
  assert.deepEqual(Object.keys(p.handlers).sort(), ['touchmove', 'touchstart', 'wheel']);
  release();
  assert.deepEqual(Object.keys(p.handlers), []);
  assert.equal(typeof web.keepScrollInside(null), 'function');
  web.keepScrollInside(undefined)();
});

t('the bottom of what the person sees: the visual viewport where there is one', () => {
  assert.equal(web.viewBottom({ innerHeight: 800 }), 800);
  assert.equal(web.viewBottom({ innerHeight: 800, visualViewport: { height: 640, offsetTop: 0 } }), 640);
  assert.equal(web.viewBottom({ innerHeight: 800, visualViewport: { height: 640, offsetTop: 30 } }), 670);
  assert.equal(web.viewBottom({}), 0);
});

console.log(`\n${n} checks passed`);
