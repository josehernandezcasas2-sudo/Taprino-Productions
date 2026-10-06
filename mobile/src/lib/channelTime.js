// Channel time is Pacific for every viewer, like a broadcast schedule. The
// server says what Pacific time it was (channelSec, seconds since
// midnight) at serverTime; everything here is plain arithmetic from that,
// so it doesn't depend on the phone's time zone support.

const DAY = 86400;

export function clockLabel(sec) {
  const s = ((Math.round(sec) % DAY) + DAY) % DAY;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Seconds to add to a UTC time-of-day to get Pacific time-of-day.
export function pacificOffset(now) {
  if (!now || now.channelSec == null || !now.serverTime) return null;
  const utcSec = (Date.parse(now.serverTime) / 1000) % DAY;
  let off = now.channelSec - utcSec;
  if (off > DAY / 2) off -= DAY;
  if (off < -DAY / 2) off += DAY;
  return off;
}

// "9:56 AM" for an ISO timestamp, in Pacific time.
export function pacificLabel(iso, offset) {
  if (!iso || offset == null) return '';
  return clockLabel(Date.parse(iso) / 1000 + offset);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY * 1000).toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dayLabel(dateStr, today) {
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
