import { useState } from 'react';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

// Read-only — no admin controls here. `todaysDayOfWeek` and `nowOnAirSlotId`
// come from the server so "today" and "on now" are computed in the fixed
// channel timezone (America/Los_Angeles) rather than the visitor's own
// browser clock, which could be a different day entirely for someone
// checking late at night from a different timezone.
//
// `currentProgramSource` / `currentProgramTitle` cover the case a plain
// per-row highlight can't: when the current moment falls in a gap between
// scheduled slots (or a day with nothing scheduled at all), no row in the
// list corresponds to what's actually on air. Without this banner, that
// case showed no "on now" indicator anywhere on the page — technically
// correct (nothing IS scheduled right then) but reads as broken rather
// than as the honest "regular rotation is filling this gap" answer it
// actually is.
export default function ChannelSchedule({ schedule, todaysDayOfWeek, nowOnAirSlotId, currentProgramSource, currentProgramTitle }) {
  const [activeDay, setActiveDay] = useState(todaysDayOfWeek);
  const daySlots = schedule[activeDay] || [];
  const isToday = activeDay === todaysDayOfWeek;

  return (
    <div className="channel-schedule">
      {isToday && currentProgramTitle && (
        <div className={`channel-schedule-onair-banner ${currentProgramSource === 'loop' ? 'loop' : ''}`}>
          <span className="channel-schedule-onair-dot" />
          On now: <strong>{currentProgramTitle}</strong>
          {currentProgramSource === 'loop' && <span className="channel-schedule-onair-note"> — regular rotation, not on today's schedule</span>}
        </div>
      )}

      <h2 className="channel-schedule-title">{isToday ? "Today's Schedule" : `${activeDay[0].toUpperCase()}${activeDay.slice(1)}'s Schedule`}</h2>

      <div className="channel-schedule-tabs">
        {DAYS.map((day) => (
          <button
            key={day}
            className={`channel-schedule-tab ${day === activeDay ? 'active' : ''}`}
            onClick={() => setActiveDay(day)}
          >
            {day === todaysDayOfWeek ? 'Today' : DAY_LABELS[day]}
          </button>
        ))}
      </div>

      {daySlots.length === 0 ? (
        <p className="channel-schedule-empty">
          Nothing specially scheduled for this day &mdash; the regular rotation of free episodes plays all day.
        </p>
      ) : (
        <div className="channel-schedule-list">
          {daySlots.map((slot) => {
            const onNow = isToday && slot.id === nowOnAirSlotId;
            return (
              <div key={slot.id} className={`channel-schedule-row ${onNow ? 'on-now' : ''}`}>
                <div className="channel-schedule-time">
                  {onNow && <span className="channel-schedule-onair">ON NOW</span>}
                  {slot.startLabel}
                </div>
                <div className="channel-schedule-info">
                  <div className="channel-schedule-item-title">
                    {slot.slotType === 'ad_break' ? 'Ad break' : (slot.episode ? slot.episode.title : 'Programming')}
                  </div>
                  {slot.slotType !== 'ad_break' && slot.episode && (
                    <div className="channel-schedule-item-sub">{slot.episode.genre}</div>
                  )}
                </div>
              </div>
            );
          })}
          {isToday && currentProgramSource === 'loop' && (
            <p className="channel-schedule-gap-note">
              Between scheduled slots right now — the regular rotation is filling the gap.
            </p>
          )}
        </div>
      )}
      <p className="channel-schedule-tz-note">All times Pacific.</p>
    </div>
  );
}
