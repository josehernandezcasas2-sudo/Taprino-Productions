import { useEffect, useRef, useState } from 'react';
import { DAY_SECONDS, SHORT_GAP_SECONDS } from '../lib/channelPlan';
import {
  SNAP_SECONDS, snapToGrid, magnetStart, fitLength, arrange, blockerOf, rerunProblem, dayGaps, hasFixedLength, isSeriesKind, fitSummary, overlaps
} from '../lib/scheduleLayout';

// One day of the channel scheduler: the hour lane with every block on it.
// Blocks drag to move (pointer events, so mouse, pen and touch all work),
// pull from the bottom edge to change length, and can be dropped on a day
// tab (anything with data-daykey) to move days. All the rules live in
// lib/scheduleLayout.js; this only draws and reports what the pointer did:
//   onSelect(id)                      a plain click
//   onPlace(item, sec)                a library item dropped or placed in a gap
//   onArrange(slots | null, info)     a finished drag: the new day, or null + info.error
//   onMoveToDay(id, dayKey)           dropped on another day's tab
//   onTabHover(dayKey | null)         so the page can light the tab up

export const ZOOM = { compact: 40, normal: 64, roomy: 100 };
export const KIND_ICON = { series_continue: '⟳', series_rerun: '↺', series_pinned: '▣', live: '●' };

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
  slots, ghosts = [], seriesById = {}, layer, px, picked, selectedId, canLive, isPastDay, isToday, nowSec,
  onSelect, onPlace, onArrange, onMoveToDay, onTabHover, needPick
}) {
  const laneRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [dropping, setDropping] = useState(false);

  // Open on the first thing scheduled (or now, whichever comes first).
  useEffect(() => {
    if (!scrollRef.current) return;
    const first = slots.length ? Math.min(...slots.map((s) => s.start)) : 17 * 3600;
    const at = Math.min(isToday && nowSec != null ? nowSec : first, first) - 1800;
    scrollRef.current.scrollTop = Math.max(0, (at / 3600) * px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const y = (sec) => (sec / 3600) * px;
  const secAt = (clientY) => ((clientY - laneRef.current.getBoundingClientRect().top) / px) * 3600;
  const epsFor = (s) => (s.seriesId && seriesById[s.seriesId] ? seriesById[s.seriesId].episodes : []);
  const locked = (s) => isPastDay || (s.kind === 'live' && !canLive);
  const problemFor = (daySlots, id) => {
    const hit = blockerOf(daySlots, id);
    if (hit) return `No room there, it overlaps ${hit.title} (${clock(hit.start)}–${clock(hit.start + hit.durationSeconds)})`;
    return rerunProblem(daySlots, id);
  };

  function startDrag(e, s) {
    if (e.button !== 0 || locked(s)) return;
    const onHandle = !!(e.target.closest && e.target.closest('.sch-handle'));
    if (onHandle && hasFixedLength(s)) return;
    e.preventDefault();
    const d = { mode: onHandle ? 'resize' : 'move', id: s.id, y0: e.clientY, orig: { start: s.start, durationSeconds: s.durationSeconds }, moved: false, result: null, tab: null };
    dragRef.current = d;
    const others = slots.filter((x) => x.id !== s.id);

    const move = (ev) => {
      const dy = ev.clientY - d.y0;
      if (!d.moved && Math.abs(dy) < 4) return;
      if (!d.moved) document.body.classList.add('sch-dragging');
      d.moved = true;
      const dsec = (dy / px) * 3600;
      let change;
      if (d.mode === 'move') {
        const start = magnetStart(clamp(snapToGrid(d.orig.start + dsec), 0, DAY_SECONDS - s.durationSeconds), s.durationSeconds, others);
        change = { id: s.id, start, durationSeconds: s.durationSeconds };
      } else {
        change = { id: s.id, start: s.start, durationSeconds: fitLength(s, snapToGrid(d.orig.durationSeconds + dsec), others, epsFor(s)) };
      }
      const res = arrange(slots, change);
      const problem = problemFor(res.slots, s.id);
      d.result = { slots: res.slots, removed: res.removed, pushed: res.pushed, change, valid: !problem, problem };
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const tab = d.mode === 'move' && el && el.closest ? el.closest('[data-daykey]') : null;
      d.tab = tab && tab.getAttribute('data-droppable') === 'true' ? tab.getAttribute('data-daykey') : null;
      if (onTabHover) onTabHover(d.tab);
      setPreview({ slots: res.slots, id: s.id, mode: d.mode, valid: !problem, pushed: res.pushed });
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
      if (!d.moved) { onSelect(s.id); return; }
      if (d.tab) { onMoveToDay(s.id, d.tab); return; }
      const r = d.result;
      if (!r) return;
      if (!r.valid) { onArrange(null, { error: r.problem }); return; }
      if (r.change.start === d.orig.start && r.change.durationSeconds === d.orig.durationSeconds) return;
      const msg = d.mode === 'move'
        ? `Moved to ${clock(r.change.start)}`
        : `Now ${dur(r.change.durationSeconds)}, ends ${clock(r.change.start + r.change.durationSeconds)}`;
      onArrange(r.slots, { removed: r.removed, msg, select: s.id });
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
              onPlace(item || picked, secAt(e.clientY));
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
                  onClick={(e) => (picked ? onPlace(picked, clamp(secAt(e.clientY), g.start, g.end - SNAP_SECONDS)) : needPick())}
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
              const dragging = preview && preview.id === s.id;
              const eps = isSeriesKind(s.kind) ? epsFor(s) : [];
              const fit = eps.length ? fitSummary(s, eps, shown) : null;
              const cls = [
                'sch-slot', `k-${s.kind}`,
                s.unavailable ? 'unavailable' : '',
                selectedId === s.id ? 'selected' : '',
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
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id); } }}
                  aria-label={`${s.title}, ${clock(s.start)} to ${clock(s.start + s.durationSeconds)}`}
                  aria-pressed={selectedId === s.id}
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
        <span>Drag to move · pull the bottom edge to change the length · drop on a day tab to move days</span>
      </div>
    </div>
  );
}
