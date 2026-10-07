import { useState } from 'react';
import { DAY_SECONDS } from '../lib/channelPlan';
import { overlaps, snapToGrid, magnetStart, arrange, dayProblem } from '../lib/scheduleLayout';
import { clock, dur, KIND_ICON } from './ScheduleTimeline';

// The week at a glance: one row per day with time running across, like a
// TV guide. The rows double as the day tabs (click one to open that day),
// a bar jumps to its block, and bars drag: sideways to change the time,
// up or down to change the day. A block dragged on the day timeline can
// also be dropped on a row (rows carry data-daykey, which is what
// ScheduleTimeline looks for under the pointer). Bar drags report back as
//   onMoveBar({ id, fromKey, toKey, start, slots, removed }) — slots is the
//   target day already arranged — or onMoveBar(null, problem).
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const LABEL_FROM = 2 * 3600; // bars shorter than this are too narrow for text
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function ScheduleWeekStrip({ days, draft, ghostsFor, selectedDay, selectedIds, dirty, hoverDay, nowSec, canLive, adGap = 0, onPickDay, onPickSlot, onMoveBar }) {
  const [drag, setDrag] = useState(null); // { id, fromKey, toKey, start, valid, slot }
  const pct = (sec) => `${(sec / DAY_SECONDS) * 100}%`;

  function startBarDrag(e, d, s, lane) {
    if (e.button !== 0 || d.past || (s.kind === 'live' && !canLive)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = lane.getBoundingClientRect();
    const st = { x0: e.clientX, y0: e.clientY, moved: false, result: null };
    const move = (ev) => {
      const dx = ev.clientX - st.x0;
      const dy = ev.clientY - st.y0;
      if (!st.moved && Math.hypot(dx, dy) < 4) return;
      if (!st.moved) document.body.classList.add('sch-dragging');
      st.moved = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el && el.closest ? el.closest('.sch-ws-row') : null;
      const toDay = (row && days.find((x) => x.key === row.getAttribute('data-daykey'))) || d;
      const target = (draft[toDay.key] || []).filter((x) => x.id !== s.id);
      let start = clamp(snapToGrid(s.start + (dx / rect.width) * DAY_SECONDS), 0, DAY_SECONDS - s.durationSeconds);
      start = magnetStart(start, s.durationSeconds, target, adGap);
      const r = arrange(target.concat([{ ...s, start }]), { id: s.id, start, durationSeconds: s.durationSeconds });
      let problem = toDay.past ? 'That day already aired.' : null;
      if (!problem && toDay.key !== d.key && (s.kind === 'series_rerun' || (draft[d.key] || []).some((o) => o.rerunOf === s.id))) problem = 'Reruns stay with the block they copy. Change the rerun first.';
      if (!problem) problem = dayProblem(r.slots, [s.id]);
      st.result = { id: s.id, fromKey: d.key, toKey: toDay.key, start, slots: r.slots, removed: r.removed, problem };
      setDrag({ id: s.id, fromKey: d.key, toKey: toDay.key, start, valid: !problem, slot: s });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('sch-dragging');
      setDrag(null);
      if (!st.moved) { onPickSlot(d.key, s.id); return; }
      const r = st.result;
      if (!r) return;
      if (r.problem) { onMoveBar(null, r.problem); return; }
      if (r.toKey === r.fromKey && r.start === s.start) return;
      onMoveBar(r);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const bar = (d, s, extraCls, lane) => (
    <button
      key={s.id}
      type="button"
      className={`sch-ws-bar k-${s.kind} ${selectedIds && selectedIds.has(s.id) && d.key === selectedDay ? 'sel' : ''} ${extraCls || ''}`}
      style={{ left: pct(s.start), width: pct(s.durationSeconds) }}
      title={`${s.title} · ${clock(s.start)}–${clock(s.start + s.durationSeconds)}`}
      aria-label={`${d.label}: ${s.title}, ${clock(s.start)} to ${clock(s.start + s.durationSeconds)}`}
      onPointerDown={(e) => startBarDrag(e, d, s, lane || e.currentTarget.parentElement)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickSlot(d.key, s.id); } }}
    >
      {s.durationSeconds >= LABEL_FROM ? `${KIND_ICON[s.kind] ? `${KIND_ICON[s.kind]} ` : ''}${s.title}` : ''}
    </button>
  );

  return (
    <div className="sch-ws" role="tablist" aria-label="Week at a glance">
      <div className="sch-ws-hours" aria-hidden="true">
        <div />
        <div>{HOURS.map((h) => <span key={h} style={{ left: pct(h * 3600) }}>{clock(h * 3600).replace(':00', '')}</span>)}</div>
      </div>
      {days.map((d) => {
        let slots = (draft[d.key] || []).slice().sort((a, b) => a.start - b.start);
        if (drag) slots = slots.filter((s) => s.id !== drag.id);
        const ghosts = (ghostsFor ? ghostsFor(d.key) : []).filter((g) => !slots.some((s) => overlaps(s, g)));
        const total = (draft[d.key] || []).reduce((sum, s) => sum + s.durationSeconds, 0);
        const sel = d.key === selectedDay;
        const over = hoverDay === d.key || (drag && drag.toKey === d.key && drag.toKey !== drag.fromKey);
        return (
          <div
            key={d.key}
            className={`sch-ws-row ${sel ? 'sel' : ''} ${d.past ? 'past' : ''} ${over ? 'over' : ''}`}
            data-daykey={d.key}
            data-droppable={!d.past && !sel}
          >
            <button type="button" role="tab" aria-selected={sel} className={`sch-ws-head ${d.isToday ? 'today' : ''}`} title={d.isToday ? 'Today' : undefined} onClick={() => onPickDay(d.key)}>
              <span>{d.label}{dirty.has(d.key) ? ' •' : ''}</span>
              <small>{total ? dur(Math.round(total / 60) * 60) : 'open'}</small>
            </button>
            {/* The lane is a click target for the row; the bars inside stop that click. */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div className="sch-ws-lane" onClick={() => onPickDay(d.key)}>
              {ghosts.map((g) => (
                <span key={`g-${g.id}`} className={`sch-ws-bar ghost k-${g.kind}`} style={{ left: pct(g.start), width: pct(g.durationSeconds) }} title={`${g.title} · ${clock(g.start)}–${clock(g.start + g.durationSeconds)} · default schedule`} />
              ))}
              {slots.map((s) => bar(d, s))}
              {drag && drag.toKey === d.key && bar(d, { ...drag.slot, start: drag.start }, `dragging ${drag.valid ? '' : 'invalid'}`)}
              {d.isToday && nowSec != null && <i className="sch-ws-now" style={{ left: pct(nowSec) }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
