import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { keepScrollInside, panelRoom, riseRoom, viewBottom } from '../../../lib/menuScroll';

// The ⋯ menu on a Your work row (2026-11-15, the revamp; the agreement is
// mockups/work-revamp-contract.md). Jose's complaint about the old gear
// menu was that it never closed on a click away or Escape, so this one
// does both, and also after an action; the page keeps one open at a time
// (`open` comes from it). Every item has a word, an icon and, for a
// toggle, its state on the right ("On" / "Off").
//
// Keyboard: the menu opens with the focus on its first item; ↑/↓, Home and
// End move through the items, Escape or Tab closes it and puts the focus
// back on the ⋯. When an action closes it while the focus is inside, the
// focus goes back to the ⋯ too (a box it opens then takes it).
//
// The menu hangs under the ⋯, or rises above it when there isn't room
// below and there is more above, and is never taller than the room it has
// (lib/menuScroll.js: panelRoom / riseRoom, measured, and keepScrollInside
// so a wheel or a finger on it never moves the page behind).
//
// items: [{ key, label, icon, detail?, tone?, checked? (a toggle),
//           href?, external?, disabled?, keepOpen?, onSelect? }]

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const GAP = 6;

export function DotsIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function itemsOf(menu) {
  return menu ? Array.from(menu.querySelectorAll('[data-wk-item]:not([disabled])')) : [];
}

export default function WorkMenu({ label, open, onToggle, onClose, items, describedBy }) {
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const focusInside = useRef(false);
  const wasOpen = useRef(false);
  const menuId = useId();
  // The page hands a new onClose each render; the listeners read the latest.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const backToButton = () => { if (btnRef.current) btnRef.current.focus({ preventScroll: true }); };

  // A click anywhere outside, or Escape, closes it.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { focusInside.current = false; closeRef.current(); } };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      focusInside.current = false;
      closeRef.current();
      backToButton();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // Opened: the first item takes the focus. Closed while the focus was in
  // it (an action, the copy's two seconds): the ⋯ takes it back.
  useIsoLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const first = itemsOf(menuRef.current)[0];
      if (first) first.focus({ preventScroll: true });
    }
    if (!open && wasOpen.current && focusInside.current) {
      focusInside.current = false;
      backToButton();
    }
    wasOpen.current = open;
  }, [open]);

  // Where it opens and how tall it may be.
  useIsoLayoutEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    const btn = btnRef.current;
    if (!menu || !btn) return undefined;
    let up = null;
    const fit = () => {
      const r = btn.getBoundingClientRect();
      // The phone's tab bar floats over the bottom of the page (on a wide
      // screen the same element is the rail, which a menu never clears).
      const tab = document.querySelector('.tabbar');
      const tr = tab ? tab.getBoundingClientRect() : null;
      const floor = tr && tr.height > 0 && tr.width > tr.height && tr.top > r.bottom ? tr.top : null;
      const header = document.querySelector('header.channel-bar');
      const ceiling = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      const below = panelRoom({ top: r.bottom + GAP, viewBottom: viewBottom(window), floor });
      const above = riseRoom({ bottom: r.top - GAP, ceiling });
      if (up === null) {
        menu.style.setProperty('--wk-menu-max', 'none');
        const natural = menu.scrollHeight;
        up = natural > below && above > below;
        menu.dataset.place = up ? 'up' : 'down';
      }
      menu.style.setProperty('--wk-menu-max', `${up ? above : below}px`);
    };
    fit();
    const release = keepScrollInside(menu);
    const vv = window.visualViewport;
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    if (vv) vv.addEventListener('resize', fit);
    return () => {
      release();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
      if (vv) vv.removeEventListener('resize', fit);
    };
  }, [open]);

  const onMenuKey = (e) => {
    const list = itemsOf(menuRef.current);
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[(at - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'Tab') {
      e.preventDefault();
      focusInside.current = false;
      onClose();
      backToButton();
      return;
    }
    if (next) { e.preventDefault(); next.focus(); }
  };

  const pick = (it) => {
    if (it.onSelect) it.onSelect();
    if (!it.keepOpen) onClose();
  };

  const shown = (items || []).filter(Boolean);
  const firstDanger = shown.findIndex((it) => it.tone === 'danger');

  return (
    <div className="wk-more-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`wk-more${open ? ' on' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined}
        aria-describedby={describedBy}
        onClick={onToggle}
      >
        <DotsIcon size={18} />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          className="wk-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          onFocus={() => { focusInside.current = true; }}
          onBlur={(e) => { if (!menuRef.current || !menuRef.current.contains(e.relatedTarget)) focusInside.current = false; }}
        >
          {shown.map((it, i) => {
            const Icon = it.icon;
            const toggle = typeof it.checked === 'boolean';
            const inner = (
              <>
                {Icon ? <span className="wk-menu-icon">{Icon}</span> : null}
                <span className="wk-menu-label">{it.label}</span>
                {it.detail ? <span className={`wk-menu-detail${toggle && it.checked ? ' on' : ''}${it.key === 'sell' ? ' price' : ''}`}>{it.detail}</span> : null}
              </>
            );
            const cls = `wk-menu-item${it.tone === 'danger' ? ' danger' : ''}`;
            const sep = i === firstDanger && i > 0 ? <div className="wk-menu-sep" role="separator" key={`sep-${it.key}`} /> : null;
            if (it.href && it.external) {
              return [sep, (
                <a key={it.key} data-wk-item="" role="menuitem" className={cls} href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => pick(it)}>
                  {inner}<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              )];
            }
            if (it.href) {
              return [sep, (
                <Link key={it.key} data-wk-item="" role="menuitem" className={cls} href={it.href} onClick={() => pick(it)}>
                  {inner}
                </Link>
              )];
            }
            return [sep, (
              <button
                key={it.key}
                type="button"
                data-wk-item=""
                role={toggle ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={toggle ? (it.checked ? 'true' : 'false') : undefined}
                className={cls}
                disabled={it.disabled}
                onClick={() => pick(it)}
              >
                {inner}
              </button>
            )];
          })}
        </div>
      )}
    </div>
  );
}
