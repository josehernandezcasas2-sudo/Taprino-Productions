import { useEffect, useRef, useState } from 'react';
import { DAY_SECONDS, SHORT_GAP_SECONDS } from '../lib/channelPlan';
import {
  SNAP_SECONDS, snapToGrid, magnetStart, fitLength, arrange, arrangeMany, ripple, dayProblem, dayGaps, hasFixedLength, isSeriesKind, fitSummary, overlaps
} from '../lib/scheduleLayout';

// One day of the channel scheduler: the hour lane with every block on it.
// Blocks drag to move (pointer events, so mouse, pen and touch all work),
// pull from the bottom edge to change length, and can be dropped on a day
// row (anything with data-daykey) to move days. Shift-click or Ctrl-click
// adds blocks to the selection; dragging any selected block moves the
// whole set. All the rules live in lib/scheduleLayout.js; this only draws
// and reports what the pointer did:
//   onSelect(id, { toggle })          a plain click (toggle: add to / remove from the selection)
//   onPlace(item, sec, { ripple })    a library item dropped or placed in a gap
//   onArrange(slots | null, info)     a finished drag: the new day, or null + info.error
//   onMoveToDay(ids, dayKey)          dropped on another day's row
//   onTabHover(dayKey | null)         so the page can light the row up
//   onAdGapChange(seconds)            the "ads between shows" setting
//   onSpaceOut()                      space the day out with that gap
// Ripple (the toggle, or Alt while dragging) moves everything after the
// block along with it instead of only shuffling ad breaks out of the way.
// It applies to single blocks; a group drag always moves just the group.

export const ZOOM_LEVELS = [32, 48, 64, 84, 110, 140]; // px per hour, zoomed out to zoomed in
export const ZOOM = { compact: 1, normal: 2, roomy: 4 }; // the old named sizes, for a preference stored before the levels
export const KIND_ICON = { series_continue: '⟳', series_rerun: '↺', series_pinned: '▣', live: '●' };
export const AD_GAP_CHOICES = [[0, 'none, shows butt up'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [240, '4 min']];

const pad = (n) => String(n).padStart(2, '0');
export function clock(sec, withSec) {
  const s = ((Math.round(sec) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)}${withSec && r ? `:${pad(r)}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}
export function dur(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h${m ? ` ${m}m` : ''}${r ? ` ${r}s` : ''}`;
  if (m) return `${m}m${r ? ` ${r}s` : ''}`;
  return `${r}s`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function ScheduleTimeline({
  slots, ghosts = [], seriesById = {}, layer, px, picked, selectedIds, canLive, isPastDay, isToday, nowSec, adGap = 0,
  onSelect, onPlace, onArrange, onMoveToDay, onTabHover, onAdGapChange, onSpaceOut, onZoom, needPick
}) {
  const laneRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [dropping, setDropping] = useState(false);
  const [rippleMode, setRippleMode] = useState(false);
  useEffect(() => {
    try { setRippleMode(window.localStorage.getItem('sch-ripple') === 'on'); } catch (err) { /* private mode */ }
  }, []);
  function setRipple(on) {
    setRippleMode(on);
    try { window.localStorage.setItem('sch-ripple', on ? 'on' : 'off'); } catch (err) { /* private mode */ }
  }
  const rippleFor = (ev) => rippleMode !== !!(ev && ev.altKey);

  // Open on the first thing scheduled (or now, whichever comes first).
  useEffect(() => {
    if (!scrollRef.current) return;
    const first = slots.length ? Math.min(...slots.map((s) => s.start)) : 17 * 3600;
    const at = Math.min(isToday && nowSec != null ? nowSec : first, first) - 1800;
    scrollRef.current.scrollTop = Math.max(0, (at / 3600) * px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Zooming keeps whatever was mid-view in view.
  const prevPx = useRef(px);
  useEffect(() => {
    const el = scrollRef.current;
    const was = prevPx.current;
    prevPx.current = px;
    if (!el || was === px) return;
    const mid = (el.scrollTop + el.clientHeight / 2) / was;
    el.scrollTop = Math.max(0, mid * px - el.clientHeight / 2);
  }, [px]);
  // Ctrl or Alt + scroll over the day zooms it (native and non-passive, so
  // the browser's page zoom stays out of it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onZoom) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.altKey)) return;
      e.preventDefault();
      onZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoom]);

  const y = (sec) => (sec / 3600) * px;
  const secAt = (clientY) => ((clientY - laneRef.current.getBoundingClientRect().top) / px) * 3600;
  const epsFor = (s) => (s.seriesId && seriesById[s.seriesId] ? seriesById[s.seriesId].episodes : []);
  const locked = (s) => isPastDay || (s.kind === 'live' && !canLive);
  const isSelected = (id) => !!(selectedIds && selectedIds.has(id));

  function startDrag(e, s) {
    if (e.button !== 0 || locked(s)) return;
    const onHandle = !!(e.target.closest && e.target.closest('.sch-handle'));
    if (onHandle && hasFixedLength(s)) return;
    e.preventDefault();
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    // Dragging a selected block drags the whole selection along.
    const group = !onHandle && isSelected(s.id) && selectedIds.size > 1 ? slots.filter((x) => isSelected(x.id) && !locked(x)) : [s];
    const ids = group.map((x) => x.id);
    const d = { mode: onHandle ? 'resize' : 'move', id: s.id, ids, y0: e.clientY, orig: { start: s.start, durationSeconds: s.durationSeconds }, moved: false, result: null, tab: null, toggle };
    dragRef.current = d;
    const others = slots.filter((x) => x.id !== s.id);

    const move = (ev) => {
      const dy = ev.clientY - d.y0;
      if (!d.moved && Math.abs(dy) < 4) return;
      if (!d.moved) document.body.classList.add('sch-dragging');
      d.moved = true;
      const dsec = (dy / px) * 3600;
      let res;
      let problem;
      let change;
      let rippled = 0;
      if (d.mode === 'move' && group.length > 1) {
        const lo = Math.min(...group.map((g) => g.start));
        const hi = Math.max(...group.map((g) => g.start + g.durationSeconds));
        const delta = clamp(snapToGrid(dsec), -lo, DAY_SECONDS - hi);
        const changes = group.map((g) => ({ id: g.id, start: g.start + delta, durationSeconds: g.durationSeconds }));
        res = arrangeMany(slots, changes);
        problem = dayProblem(res.slots, ids);
        change = changes.find((c) => c.id === s.id);
      } else if (d.mode === 'move') {
        const start = magnetStart(clamp(snapToGrid(d.orig.start + dsec), 0, DAY_SECONDS - s.durationSeconds), s.durationSeconds, others, adGap);
        change = { id: s.id, start, durationSeconds: s.durationSeconds };
        if (rippleFor(ev)) {
          const r = ripple(slots, change, d.orig);
          res = { slots: r.slots, removed: [], pushed: r.moved };
          problem = r.problem;
          rippled = r.moved.length;
        } else {
          res = arrange(slots, change);
          problem = dayProblem(res.slots, [s.id]);
        }
      } else {
        change = { id: s.id, start: s.start, durationSeconds: fitLength(s, snapToGrid(d.orig.durationSeconds + dsec), others, epsFor(s)) };
        if (rippleFor(ev)) {
          const r = ripple(slots, change, d.orig);
          res = { slots: r.slots, removed: [], pushed: r.moved };
          problem = r.problem;
          rippled = r.moved.length;
        } else {
          res = arrange(slots, change);
          problem = dayProblem(res.slots, [s.id]);
        }
      }
      d.result = { slots: res.slots, removed: res.removed, pushed: res.pushed, change, valid: !problem, problem, rippled, groupSize: group.length };
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const tab = d.mode === 'move' && el && el.closest ? el.closest('[data-daykey]') : null;
      d.tab = tab && tab.getAttribute('data-droppable') === 'true' ? tab.getAttribute('data-daykey') : null;
      if (onTabHover) onTabHover(d.tab);
      setPreview({ slots: res.slots, ids, mode: d.mode, valid: !problem, pushed: res.pushed });
      const r = scrollRef.current.getBoundingClientRect();
      if (ev.clientY < r.top + 28) scrollRef.current.scrollTop -= 10;
      else if (ev.clientY > r.bottom - 28) scrollRef.current.scrollTop += 10;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragRef.current = null;
      document.body.classList.remove('sch-dragging');
      setPreview(null);
      if (onTabHover) onTabHover(null);
      if (!d.moved) { onSelect(s.id, { toggle: d.toggle }); return; }
      if (d.tab) { onMoveToDay(ids, d.tab); return; }
      const r = d.result;
      if (!r) return;
      if (!r.valid) { onArrange(null, { error: r.problem }); return; }
      if (r.change.start === d.orig.start && r.change.durationSeconds === d.orig.durationSeconds) return;
      let msg;
      if (r.groupSize > 1) {
        const first = Math.min(...r.slots.filter((x) => ids.includes(x.id)).map((x) => x.start));
        msg = `Moved ${r.groupSize} blocks, the first now at ${clock(first)}`;
      } else {
        msg = (d.mode === 'move'
          ? `Moved to ${clock(r.change.start)}`
          : `Now ${dur(r.change.durationSeconds)}, ends ${clock(r.change.start + r.change.durationSeconds)}`)
          + (r.rippled ? `, and the ${r.rippled} block${r.rippled === 1 ? '' : 's'} after it moved along` : '');
      }
      onArrange(r.slots, { removed: r.removed, msg, select: r.groupSize > 1 ? undefined : s.id });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const shown = (preview ? preview.slots : slots).slice().sort((a, b) => a.start - b.start);
  const gaps = dayGaps(shown);
  const visibleGhosts = ghosts.filter((g) => !shown.some((s) => overlaps(s, g)));
  const gapLabel = layer === 'week' ? 'Default schedule fills this' : 'Loop fills this';

  return (
    <div className="sch-timeline">
      {isPastDay && <div className="sch-past-note">This day has already aired. Changes here won&rsquo;t show anywhere.</div>}
      <div className="sch-tl-top">
        <span className="sch-tl-hint">Drag to move · pull the bottom edge for length · drop on a day row to move days · Shift-click to select several</span>
        <div className="sch-tl-ctrls">
          <label className="sch-gapset">
            <span>Ads between shows</span>
            <select id="sch-adgap" value={adGap} onChange={(e) => onAdGapChange(Number(e.target.value))} aria-label="Ads between shows">
              {AD_GAP_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="sch-btn sm" onClick={onSpaceOut} disabled={isPastDay || !adGap} title="Move shows apart so each one has the gap after it">Space out</button>
          </label>
          <div className="sch-ripple" role="group" aria-label="Ripple">
            <span>Ripple</span>
            <div className="sch-seg sch-seg-xs">
              <button type="button" aria-selected={!rippleMode} onClick={() => setRipple(false)}>Off</button>
              <button type="button" aria-selected={rippleMode} onClick={() => setRipple(true)}>On</button>
            </div>
            <small>{rippleMode ? 'Moving or stretching a block pushes everything after it along. Alt turns it off for one drag.' : 'Hold Alt while dragging to push everything after the block along.'}</small>
          </div>
        </div>
      </div>
      <div className="sch-scroll" ref={scrollRef}>
        <div className="sch-tl" style={{ height: y(DAY_SECONDS) }}>
          <div className="sch-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: px }}>{clock(h * 3600).replace(':00', '')}</div>)}
          </div>
          <div
            ref={laneRef}
            className={`sch-lane ${dropping ? 'drop' : ''}`}
            style={{ background: `repeating-linear-gradient(var(--surface-1) 0 ${px - 1}px, var(--ocean-ink) ${px - 1}px ${px}px)` }}
            onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              let item = null;
              try { item = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { item = null; }
              onPlace(item || picked, secAt(e.clientY), { ripple: rippleFor(e) });
            }}
          >
            {isToday && nowSec != null && <div className="sch-pastshade" style={{ height: y(nowSec) }} />}

            {gaps.map((g) => {
              const len = g.end - g.start;
              if (len < SHORT_GAP_SECONDS) {
                return <div key={`ads-${g.start}`} className="sch-gap-ads" style={{ top: y(g.start), height: Math.max(2, y(len)) }} title={`${dur(len)} gap · ads and bumpers play`} />;
              }
              return (
                <button
                  key={`gap-${g.start}`}
                  type="button"
                  className={`sch-slot gap ${picked ? 'armed' : ''}`}
                  style={{ top: y(g.start) + 1, height: Math.max(y(len) - 2, 6) }}
                  onClick={(e) => (picked ? onPlace(picked, clamp(secAt(e.clientY), g.start, g.end - SNAP_SECONDS), { ripple: rippleFor(e) }) : needPick())}
                  aria-label={`Open ${clock(g.start)} to ${clock(g.end)}${picked ? `, place ${picked.name} here` : ''}`}
                >
                  {len >= 1200 && <span>{picked ? `Place ${picked.name} here` : gapLabel}</span>}
                  {len >= 1200 && <small>{clock(g.start)}–{clock(g.end)}</small>}
                </button>
              );
            })}

            {visibleGhosts.map((g) => (
              <div key={`ghost-${g.id}`} className={`sch-slot ghost k-${g.kind}`} style={{ top: y(g.start) + 1, height: Math.max(y(g.durationSeconds) - 2, 16) }} aria-hidden="true">
                <span className="sch-slot-hd"><b>{KIND_ICON[g.kind] ? `${KIND_ICON[g.kind]} ` : ''}{g.title}</b><small>{clock(g.start)}–{clock(g.start + g.durationSeconds)}</small></span>
                {y(g.durationSeconds) >= 34 && <small className="sch-sub">default schedule</small>}
              </div>
            ))}

            {shown.map((s) => {
              const h = Math.max(y(s.durationSeconds) - 2, 16);
              const dragging = preview && preview.ids.includes(s.id);
              const eps = isSeriesKind(s.kind) ? epsFor(s) : [];
              const fit = eps.length ? fitSummary(s, eps, shown) : null;
              const cls = [
                'sch-slot', `k-${s.kind}`,
                s.unavailable ? 'unavailable' : '',
                isSelected(s.id) ? 'selected' : '',
                dragging ? 'dragging' : '',
                dragging && !preview.valid ? 'invalid' : '',
                preview && preview.pushed.includes(s.id) ? 'pushed' : '',
                locked(s) ? 'locked' : ''
              ].join(' ');
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  className={cls}
                  style={{ top: y(s.start) + 1, height: h }}
                  onPointerDown={(e) => startDrag(e, s)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id, { toggle: e.shiftKey || e.ctrlKey || e.metaKey }); } }}
                  aria-label={`${s.title}, ${clock(s.start)} to ${clock(s.start + s.durationSeconds)}`}
                  aria-pressed={isSelected(s.id)}
                >
                  <span className="sch-slot-hd">
                    <b>
                      {KIND_ICON[s.kind] ? `${KIND_ICON[s.kind]} ` : ''}{s.title}
                      {s.kind === 'series_pinned' && s.pinLabel ? <small> from {s.pinLabel}</small> : null}
                      {s.kind === 'series_rerun' ? <small> rerun</small> : null}
                    </b>
                    <small>
                      {clock(s.start)}–{clock(s.start + s.durationSeconds)}
                      {hasFixedLength(s) ? ' · runtime' : ''}
                      {fit && fit.leftover < 60 && fit.count > 0 ? <span className="sch-badge">exact</span> : null}
                    </small>
                  </span>
                  {fit && h >= 34 && (
                    <small className="sch-sub">
                      {fit.count} ep{fit.count === 1 ? '' : 's'}{fit.leftover > 0 ? ` + ${dur(fit.leftover)} ads` : ''}{fit.count === 0 ? ' · too short for an episode' : ''}
                    </small>
                  )}
                  {fit && h >= 44 && fit.items.map((it, i) => (i > 0 && y(it.at) >= 20
                    ? <div key={it.episode.id} className="sch-tick" style={{ top: y(it.at) }}><small>{it.episode.label || it.episode.title}</small></div>
                    : null))}
                  {fit && h >= 44 && fit.leftover > 0 && fit.count > 0 && (
                    <div className="sch-tail" style={{ height: y(fit.leftover) }}>{y(fit.leftover) >= 14 ? <small>ads + bumpers · {dur(fit.leftover)}</small> : null}</div>
                  )}
                  {s.kind === 'ad_break' && h >= 30 && <small className="sch-sub">{dur(s.durationSeconds)}</small>}
                  {s.unavailable && <small className="sch-sub">Not available anymore · falls through to {layer === 'week' ? 'the default' : 'the loop'}</small>}
                  {!hasFixedLength(s) && !locked(s) && <div className="sch-handle" title="Pull to change the length" />}
                </div>
              );
            })}

            {isToday && nowSec != null && <div className="sch-now" style={{ top: y(nowSec) }}><small>now {clock(nowSec)}</small></div>}
          </div>
        </div>
      </div>
      <div className="sch-legend">
        <span><i style={{ background: 'repeating-linear-gradient(135deg, rgba(251,232,211,.3) 0 2px, transparent 2px 4px)' }} />Gaps under 5 min play ads and bumpers</span>
        {layer === 'week' && <span><i style={{ border: '1px dashed var(--sky)' }} />Faded = the default schedule, filling what&rsquo;s open</span>}
        <span><i style={{ outline: '1px dashed var(--olive)', outlineOffset: '-1px' }} />Dashed outline = moved along with the block you&rsquo;re dragging</span>
      </div>
    </div>
  );
}
