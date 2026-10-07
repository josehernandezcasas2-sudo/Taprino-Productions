import { DAY_SECONDS } from '../lib/channelPlan';
import { overlaps } from '../lib/scheduleLayout';
import { clock, dur, KIND_ICON } from './ScheduleTimeline';

// The week at a glance: one row per day with time running across, like a
// TV guide. The rows double as the day tabs (click one to open that day),
// a bar jumps to its block, and a block dragged on the day timeline can be
// dropped on a row to move it to that day (rows carry data-daykey, which is
// what ScheduleTimeline looks for under the pointer).
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const LABEL_FROM = 2 * 3600; // bars shorter than this are too narrow for text

export default function ScheduleWeekStrip({ days, draft, ghostsFor, selectedDay, selectedId, dirty, hoverDay, nowSec, onPickDay, onPickSlot }) {
  const pct = (sec) => `${(sec / DAY_SECONDS) * 100}%`;
  return (
    <div className="sch-ws" role="tablist" aria-label="Week at a glance">
      <div className="sch-ws-hours" aria-hidden="true">
        <div />
        <div>{HOURS.map((h) => <span key={h} style={{ left: pct(h * 3600) }}>{clock(h * 3600).replace(':00', '')}</span>)}</div>
      </div>
      {days.map((d) => {
        const slots = (draft[d.key] || []).slice().sort((a, b) => a.start - b.start);
        const ghosts = (ghostsFor ? ghostsFor(d.key) : []).filter((g) => !slots.some((s) => overlaps(s, g)));
        const total = slots.reduce((sum, s) => sum + s.durationSeconds, 0);
        const sel = d.key === selectedDay;
        return (
          <div
            key={d.key}
            className={`sch-ws-row ${sel ? 'sel' : ''} ${d.past ? 'past' : ''} ${hoverDay === d.key ? 'over' : ''}`}
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
              {slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`sch-ws-bar k-${s.kind} ${s.id === selectedId && sel ? 'sel' : ''}`}
                  style={{ left: pct(s.start), width: pct(s.durationSeconds) }}
                  title={`${s.title} · ${clock(s.start)}–${clock(s.start + s.durationSeconds)}`}
                  aria-label={`${d.label}: ${s.title}, ${clock(s.start)} to ${clock(s.start + s.durationSeconds)}`}
                  onClick={(e) => { e.stopPropagation(); onPickSlot(d.key, s.id); }}
                >
                  {s.durationSeconds >= LABEL_FROM ? `${KIND_ICON[s.kind] ? `${KIND_ICON[s.kind]} ` : ''}${s.title}` : ''}
                </button>
              ))}
              {d.isToday && nowSec != null && <i className="sch-ws-now" style={{ left: pct(nowSec) }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
