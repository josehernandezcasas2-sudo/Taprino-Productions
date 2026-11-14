// A menu that scrolls keeps its scrolling to itself (Jose, 2026-11-14:
// "have the section be scrollable apart from the rest of the site …
// currently it either doesn't scroll or it scrolls with the site. I want
// to be able to reach any of the sections regardless of device").
//
// The header's panels (browse, search, notifications, account) hang from
// under the nav bar and the tab bar's menus rise from it; each is its own
// scroll area, never taller than the room it has. CSS does most of it
// (max-height, overflow-y: auto, overscroll-behavior: contain); this file
// holds the two things CSS can't do everywhere:
//   * how much room a panel has (`panelRoom`, pure), and
//   * a wheel or a finger on a panel that has nothing (more) to scroll
//     must not move the page behind it (`keepScrollInside`; Your work's
//     two edit boxes use it on their backdrop too, with their fields
//     scrolling in a box inside).
// No imports; the pure half is tested by scripts/test-menu-scroll.mjs.

// The least a panel is ever given, so a very short screen (a phone held
// sideways) still shows a few rows to scroll through.
export const PANEL_LEAST = 120;
// Breathing room under a panel, and between a panel and the tab bar.
export const PANEL_GAP = 12;
export const PANEL_TAB_GAP = 8;

// How tall a panel hanging from `top` may be. `viewBottom` is the bottom
// of what the person can see; `floor` is the top of something fixed to the
// bottom of the screen that the panel must stop above (the phone's tab
// bar), or null.
export function panelRoom({ top, viewBottom, floor = null, least = PANEL_LEAST } = {}) {
  const t = Number(top);
  const b = Number(viewBottom);
  if (!Number.isFinite(t) || !Number.isFinite(b)) return least;
  let end = b - PANEL_GAP;
  const f = floor === null || floor === undefined ? NaN : Number(floor);
  if (Number.isFinite(f) && f > t) end = Math.min(end, f - PANEL_TAB_GAP);
  return Math.max(least, Math.floor(end - t));
}

// How tall a menu rising from `bottom` (the tab bar's top edge, less its
// gap) may be: up to `ceiling`, the bottom of something fixed to the top
// of the screen (the header), or the top of the screen itself.
export function riseRoom({ bottom, ceiling = 0, least = PANEL_LEAST } = {}) {
  const b = Number(bottom);
  const c = Number.isFinite(Number(ceiling)) ? Math.max(0, Number(ceiling)) : 0;
  if (!Number.isFinite(b)) return least;
  return Math.max(least, Math.floor(b - c - PANEL_GAP));
}

// Whether a scroll in that direction has nowhere to go inside the panel.
// `max` = scrollHeight − clientHeight.
export function scrollSpent({ scrollTop, max, goingDown }) {
  if (!(max > 1)) return true;
  if (goingDown) return scrollTop >= max - 1;
  return scrollTop <= 0;
}

// Whether anything from where the wheel or the finger is, up to and
// including the panel, can still scroll that way: the panel itself, or a
// scroll area inside it (a dialog's body, a tall text box). `overflowOf`
// reads an element's overflow-y (the browser's computed style unless a
// test passes its own); the panel is taken as a scroll area whatever its
// own style says.
export function roomInside(target, panel, goingDown, overflowOf) {
  const read = typeof overflowOf === 'function'
    ? overflowOf
    : (el) => (typeof getComputedStyle === 'function' ? getComputedStyle(el).overflowY : 'auto');
  const inside = target && target !== panel && typeof panel.contains === 'function' && panel.contains(target);
  let el = inside ? target : panel;
  while (el) {
    const max = (el.scrollHeight || 0) - (el.clientHeight || 0);
    if (max > 1 && !scrollSpent({ scrollTop: el.scrollTop || 0, max, goingDown })) {
      if (el === panel) return true;
      const oy = read(el);
      if (oy === 'auto' || oy === 'scroll') return true;
    }
    if (el === panel) break;
    el = el.parentElement || null;
  }
  return false;
}

// Attach to an open panel (a menu, or a dialog's backdrop); returns the
// function that detaches. A wheel or a one-finger drag that nothing in the
// panel can use is cancelled, so the page behind stays where it is. Two
// fingers (pinch) and a trackpad's ctrl-wheel zoom pass through.
export function keepScrollInside(panel, { overflowOf } = {}) {
  if (!panel || typeof panel.addEventListener !== 'function') return () => {};
  const spent = (target, goingDown) => !roomInside(target, panel, goingDown, overflowOf);

  const onWheel = (e) => {
    if (e.ctrlKey) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    if (e.deltaY === 0) return;
    if (e.cancelable && spent(e.target, e.deltaY > 0)) e.preventDefault();
  };

  let startY = null;
  const onTouchStart = (e) => { startY = e.touches && e.touches.length === 1 ? e.touches[0].clientY : null; };
  const onTouchMove = (e) => {
    if (startY === null || !e.touches || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) < 2) return;
    // A finger moving up scrolls the list down.
    if (e.cancelable && spent(e.target, dy < 0)) e.preventDefault();
  };

  panel.addEventListener('wheel', onWheel, { passive: false });
  panel.addEventListener('touchstart', onTouchStart, { passive: true });
  panel.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => {
    panel.removeEventListener('wheel', onWheel);
    panel.removeEventListener('touchstart', onTouchStart);
    panel.removeEventListener('touchmove', onTouchMove);
  };
}

// The bottom of what the person can see, in the page's own coordinates
// (the visual viewport where the browser has one: a phone's address bar
// and keyboard change it without changing the layout viewport).
export function viewBottom(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return 0;
  const vv = w.visualViewport;
  if (vv && Number.isFinite(vv.height)) return vv.height + (Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0);
  return w.innerHeight || 0;
}
