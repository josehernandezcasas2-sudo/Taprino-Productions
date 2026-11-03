import { useCallback, useEffect, useRef, useState } from 'react';

// Dragging a row on the show page (series revamp slice 2; spec Screens,
// "Show page", laptop): ScheduleTimeline's startDrag state machine lifted
// into a hook — Pointer Events on the grip, a 4px threshold before it counts
// as a drag (less is a click), body.show-dragging while it lasts, a ghost of
// the row following the pointer, a drop line between rows (with a bubble
// saying where it lands), season headers as drop targets (data-season +
// data-droppable="true"), auto-scroll near the top and bottom of the
// window, the drop found with elementFromPoint. Holding Alt over a row
// swaps the two instead. Escape cancels.
//
// The DOM it reads: each row is [data-row-id] with data-sortable="true"
// when it can be a drop neighbour; a season header is [data-season]
// [data-droppable="true"]. The ghost and the line are drawn outside React
// (they move with every pointer event); the hook's own state is only
// `draggingId`, so the room can dim the row being moved.
//
//   const { startDrag, draggingId } = useSortableRows({ enabled, onDrop, describe })
//   onDrop({ id, target })     target: { type: 'row', id, before } |
//                                      { type: 'swap', id } | { type: 'season', season }
//   describe(id, target)       → the bubble's words ("E3") or null

const THRESHOLD = 4;
const EDGE = 72;

export default function useSortableRows({ enabled = true, onDrop, describe = null } = {}) {
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);
  const cbRef = useRef({ onDrop, describe });
  cbRef.current = { onDrop, describe };

  const cleanup = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    window.removeEventListener('pointermove', d.move);
    window.removeEventListener('pointerup', d.up);
    window.removeEventListener('pointercancel', d.cancel);
    window.removeEventListener('keydown', d.key, true);
    window.removeEventListener('keyup', d.altKey, true);
    if (d.frame) cancelAnimationFrame(d.frame);
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.line && d.line.parentNode) d.line.parentNode.removeChild(d.line);
    if (d.marked) d.marked.classList.remove('is-drop-target', 'is-swap-target');
    document.body.classList.remove('show-dragging');
    setDraggingId(null);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startDrag = useCallback((e, row) => {
    if (!enabled || !row || (e.button !== undefined && e.button !== 0)) return;
    const rowEl = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('[data-row-id]') : null;
    if (!rowEl) return;
    e.preventDefault();
    const d = {
      id: row.id,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      alt: Boolean(e.altKey),
      moved: false,
      rowEl,
      ghost: null,
      line: null,
      marked: null,
      target: null,
      frame: null
    };

    const mark = (el, cls) => {
      if (d.marked && (d.marked !== el || !d.marked.classList.contains(cls))) d.marked.classList.remove('is-drop-target', 'is-swap-target');
      d.marked = el;
      if (el) el.classList.add(cls);
    };

    const placeLine = (rect, before, words) => {
      if (!d.line) return;
      d.line.style.display = 'block';
      d.line.style.left = `${rect.left}px`;
      d.line.style.width = `${rect.width}px`;
      d.line.style.top = `${(before ? rect.top : rect.bottom) - 1}px`;
      const bubble = d.line.firstChild;
      if (bubble) {
        bubble.textContent = words || '';
        bubble.style.display = words ? 'inline-flex' : 'none';
      }
    };

    // What is under the pointer now.
    const locate = () => {
      const under = document.elementFromPoint(d.x, d.y);
      let target = null;
      const head = under && under.closest ? under.closest('[data-droppable="true"][data-season]') : null;
      const other = under && under.closest ? under.closest('[data-row-id][data-sortable="true"]') : null;
      if (head) {
        target = { type: 'season', season: Number(head.getAttribute('data-season')) };
        mark(head, 'is-drop-target');
        if (d.line) d.line.style.display = 'none';
      } else if (other && other.getAttribute('data-row-id') !== String(d.id)) {
        const rect = other.getBoundingClientRect();
        const id = other.getAttribute('data-row-id');
        if (d.alt) {
          target = { type: 'swap', id };
          mark(other, 'is-swap-target');
          if (d.line) d.line.style.display = 'none';
        } else {
          const before = d.y < rect.top + rect.height / 2;
          target = { type: 'row', id, before };
          mark(null, '');
          const words = cbRef.current.describe ? cbRef.current.describe(d.id, target) : null;
          placeLine(rect, before, words);
        }
      } else {
        mark(null, '');
        if (d.line) d.line.style.display = 'none';
      }
      d.target = target;
    };

    const tick = () => {
      d.frame = null;
      if (!dragRef.current) return;
      let dy = 0;
      if (d.y < EDGE) dy = -Math.ceil((EDGE - d.y) / 6);
      else if (d.y > window.innerHeight - EDGE) dy = Math.ceil((d.y - (window.innerHeight - EDGE)) / 6);
      if (dy) {
        window.scrollBy(0, dy);
        locate();
        d.frame = requestAnimationFrame(tick);
      }
    };

    const begin = () => {
      d.moved = true;
      document.body.classList.add('show-dragging');
      const rect = rowEl.getBoundingClientRect();
      d.offsetX = d.x0 - rect.left;
      d.offsetY = d.y0 - rect.top;
      const ghost = rowEl.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.setAttribute('aria-hidden', 'true');
      ghost.classList.add('show-row-ghost');
      ghost.classList.remove('is-open', 'is-flash');
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);
      d.ghost = ghost;
      const line = document.createElement('div');
      line.className = 'show-drop-line';
      line.setAttribute('aria-hidden', 'true');
      const bubble = document.createElement('span');
      bubble.className = 'show-drop-bubble';
      line.appendChild(bubble);
      line.style.display = 'none';
      document.body.appendChild(line);
      d.line = line;
      setDraggingId(row.id);
    };

    d.move = (ev) => {
      d.x = ev.clientX;
      d.y = ev.clientY;
      d.alt = Boolean(ev.altKey);
      if (!d.moved) {
        if (Math.abs(d.x - d.x0) < THRESHOLD && Math.abs(d.y - d.y0) < THRESHOLD) return;
        begin();
      }
      if (d.ghost) d.ghost.style.transform = `translate(${d.x - d.x0}px, ${d.y - d.y0}px) rotate(-0.6deg)`;
      locate();
      if (!d.frame) d.frame = requestAnimationFrame(tick);
    };
    d.up = (ev) => {
      d.alt = Boolean(ev && ev.altKey) || d.alt;
      const { moved, target, id } = d;
      cleanup();
      if (moved && target && cbRef.current.onDrop) cbRef.current.onDrop({ id, target });
    };
    d.cancel = () => cleanup();
    d.key = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cleanup();
      } else if (ev.key === 'Alt' && !d.alt) {
        d.alt = true;
        if (d.moved) locate();
      }
    };
    d.altKey = (ev) => {
      if (ev.key === 'Alt' && d.alt) {
        d.alt = false;
        if (d.moved) locate();
      }
    };
    dragRef.current = d;
    window.addEventListener('pointermove', d.move);
    window.addEventListener('pointerup', d.up);
    window.addEventListener('pointercancel', d.cancel);
    window.addEventListener('keydown', d.key, true);
    window.addEventListener('keyup', d.altKey, true);
  }, [enabled, cleanup]);

  return { startDrag, draggingId };
}
