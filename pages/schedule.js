import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getRoleContext } from '../lib/roles';
import { schedulableChannels } from '../lib/channelAccess';
import { channelClock } from '../lib/channelEngine';
import { addDays, weekStartOf, DAY_SECONDS } from '../lib/channelPlan';
import {
  SNAP_SECONDS, snapToGrid, magnetStart, arrange, arrangeMany, ripple, insertWithRipple, spaceOut, dayProblem, defaultSeriesLength, episodeEdges, firstRoomAfter, fitSummary, hasFixedLength, isHard, limitFor
} from '../lib/scheduleLayout';
import ScheduleTimeline, { ZOOM, ZOOM_LEVELS, KIND_ICON, clock, dur } from '../components/ScheduleTimeline';
import ScheduleWeekStrip from '../components/ScheduleWeekStrip';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import { SITE } from '../lib/siteConfig';
import { useUpload } from '../contexts/UploadContext';

// The channel scheduler: admins, sub-admins with "manage the channel
// schedule", and Content Schedulers (only for channels assigned to them).
// Built for tablets and computers; phones get a note instead.
//
// Edits happen in a draft of the whole view (a week, or the default
// schedule) and land together with "Save schedule" (/api/schedule/save).
export async function getServerSideProps({ req, res, query }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const [account, roleContext] = await Promise.all([getAccountContext(req), getRoleContext(req)]);
  if (!roleContext.userId) return { redirect: { destination: '/account', permanent: false } };
  let channels = [];
  try {
    channels = await schedulableChannels(roleContext);
  } catch (err) {
    console.error('schedule page:', err.message);
  }
  if (!channels.length) return { redirect: { destination: roleContext.isCreator ? '/creator/my-work' : '/stream', permanent: false } };
  const initial = channels.find((c) => c.slug === query.channel) || channels[0];
  const today = channelClock().date;
  return {
    props: {
      channels: channels.map((c) => ({ id: c.id, slug: c.slug, name: c.name, number: c.number, visibility: c.visibility })),
      initialChannelId: initial.id,
      initialView: ['week', 'default', 'loop'].includes(query.view) ? query.view : 'week',
      today,
      canLive: !!roleContext.isAdmin,
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator
    }
  };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const KIND_INFO = {
  series_continue: { name: 'Continue', help: 'Plays the next episodes in order. The next day picks up where this one stopped.' },
  series_rerun: { name: 'Rerun', help: 'Replays what another block aired earlier the same day.' },
  series_pinned: { name: 'Pinned', help: 'Always starts at the same episode. Never moves forward.' }
};
const SERIES_KINDS = Object.keys(KIND_INFO);
const SAVE_FIELDS = ['id', 'kind', 'start', 'durationSeconds', 'episodeId', 'mediaId', 'seriesId', 'pinEpisodeId', 'rerunOf', 'title'];
const sameSlot = (a, b) => !!a && !!b && SAVE_FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));

const pad = (n) => String(n).padStart(2, '0');
function hhmm(sec) {
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}`;
}
function dateParts(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function shortDate(d) {
  return dateParts(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function weekdayOfDate(d) {
  return DAYS[(dateParts(d).getUTCDay() + 6) % 7];
}
// Channel time (Pacific) right now, for the "now" line. Null if the browser can't say.
function nowPacificSec() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(new Date());
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    return (g('hour') % 24) * 3600 + g('minute') * 60 + g('second');
  } catch (err) {
    return null;
  }
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, method === 'GET' ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let tmpCounter = 0;
const newTmpId = () => `tmp-${Date.now().toString(36)}-${++tmpCounter}`;

export default function Scheduler(props) {
  const { channels, initialChannelId, initialView, today, canLive, isSignedIn, isSubscriber, email, isAdmin, isCreator } = props;
  const router = useRouter();
  const [channelId, setChannelId] = useState(initialChannelId);
  const [view, setView] = useState(initialView);
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [day, setDay] = useState(initialView === 'default' ? weekdayOfDate(today) : today);
  const [data, setData] = useState(null);
  const [library, setLibrary] = useState(null);
  const [loop, setLoop] = useState(null);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null); // library item waiting to be placed
  const [selection, setSelection] = useState(() => new Set()); // block ids on the open day
  const [toast, setToast] = useState(null);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [nowSec, setNowSec] = useState(null);
  const [hoverTab, setHoverTab] = useState(null);
  const [adGap, setAdGap] = useState(120);
  // The draft: every day of the view, edited locally until "Save schedule".
  const [draft, setDraft] = useState({});
  const [dirty, setDirty] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [recoverable, setRecoverable] = useState(null); // an unsaved draft left behind in this browser
  const toastTimer = useRef(null);

  const channel = channels.find((c) => c.id === channelId);
  const layer = view === 'default' ? 'default' : 'week';
  const px = ZOOM_LEVELS[zoomIdx];
  const isDirty = dirty.size > 0;
  const selectedId = selection.size === 1 ? [...selection][0] : null;
  const selectOne = (id) => setSelection(id ? new Set([id]) : new Set());
  // Where this view's unsaved draft is kept in the browser, in case the tab closes.
  const draftKey = `sch-draft:${channelId}:${layer}:${layer === 'week' ? weekStart : 'default'}`;

  const flash = useCallback((msg, canUndo = false) => {
    setToast({ msg, canUndo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), canUndo ? 6000 : 2600);
  }, []);

  const groupByDay = useCallback((slots, lyr) => {
    const out = {};
    for (const s of slots) (out[lyr === 'week' ? s.airDate : s.dayOfWeek] = out[lyr === 'week' ? s.airDate : s.dayOfWeek] || []).push(s);
    return out;
  }, []);

  const loadView = useCallback(async () => {
    if (view === 'loop') return null;
    setError(null);
    try {
      const qs = view === 'default' ? 'layer=default' : `layer=week&weekStart=${weekStart}`;
      const d = await api(`/api/schedule/view?channelId=${channelId}&${qs}`);
      setData(d);
      setDraft(groupByDay(d.slots, d.layer));
      setDirty(new Set());
      setHistory([]);
      if (Number.isFinite(d.adGapSeconds)) setAdGap(d.adGapSeconds);
      // A draft left behind earlier (the tab closed with unsaved changes)?
      let stored = null;
      try {
        const raw = window.localStorage.getItem(`sch-draft:${channelId}:${d.layer}:${d.layer === 'week' ? weekStart : 'default'}`);
        stored = raw ? JSON.parse(raw) : null;
      } catch (err) { stored = null; }
      setRecoverable(stored && stored.draft && Array.isArray(stored.dirty) && stored.dirty.length ? stored : null);
      return d;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [channelId, view, weekStart, groupByDay]);

  const loadLoop = useCallback(async () => {
    try {
      setLoop((await api(`/api/schedule/loop?channelId=${channelId}`)).loop);
    } catch (err) {
      setError(err.message);
    }
  }, [channelId]);

  useEffect(() => { setData(null); loadView(); }, [loadView]);
  useEffect(() => { if (view === 'loop') loadLoop(); }, [view, loadLoop]);
  useEffect(() => {
    setLibrary(null);
    api(`/api/schedule/library?channelId=${channelId}`).then(setLibrary).catch((err) => setError(err.message));
  }, [channelId]);

  const loadMedia = useCallback(() => {
    api(`/api/schedule/media?channelId=${channelId}`).then((d) => setMedia(d.media)).catch((err) => setError(err.message));
  }, [channelId]);
  useEffect(() => { loadMedia(); }, [loadMedia]);

  // The now line, and remembering the zoom.
  useEffect(() => {
    setNowSec(nowPacificSec());
    const t = setInterval(() => setNowSec(nowPacificSec()), 30000);
    try {
      const z = window.localStorage.getItem('sch-zoom');
      if (z !== null && z in ZOOM) setZoomIdx(ZOOM[z]); // a preference from before the zoom levels
      else if (z !== null && ZOOM_LEVELS[Number(z)] !== undefined) setZoomIdx(Number(z));
    } catch (err) { /* private mode */ }
    return () => clearInterval(t);
  }, []);
  const zoomBy = useCallback((dir) => {
    setZoomIdx((i) => {
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir));
      try { window.localStorage.setItem('sch-zoom', String(next)); } catch (err) { /* private mode */ }
      return next;
    });
  }, []);

  // Don't lose a draft by accident: warn before leaving, and keep a copy in
  // the browser that the page offers back if the tab does close.
  useEffect(() => {
    if (!isDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  useEffect(() => {
    if (!isDirty) return;
    try { window.localStorage.setItem(draftKey, JSON.stringify({ draft, dirty: [...dirty], at: Date.now() })); } catch (err) { /* private mode */ }
  }, [draft, dirty, isDirty, draftKey]);
  const forgetStoredDraft = useCallback(() => {
    try { window.localStorage.removeItem(draftKey); } catch (err) { /* private mode */ }
    setRecoverable(null);
  }, [draftKey]);
  function restoreDraft() {
    if (!recoverable) return;
    setHistory([{ draft, dirty: new Set(dirty), selection }]);
    setDraft({ ...draft, ...recoverable.draft });
    setDirty(new Set(recoverable.dirty));
    setRecoverable(null);
    flash('Your unsaved changes are back', true);
  }
  const okToLeave = () => !isDirty || window.confirm('You have unsaved changes. Leave without saving them?');

  // Keep the URL shareable (?channel=&view=) without reloading the page.
  useEffect(() => {
    if (router.pathname !== '/schedule') return;
    router.replace({ pathname: '/schedule', query: { channel: channel ? channel.slug : undefined, view } }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, view]);

  function switchView(next) {
    if (next === view || !okToLeave()) return;
    setView(next);
    selectOne(null);
    setPicked(null);
    if (next === 'default') setDay(weekdayOfDate(today));
    if (next === 'week') {
      setWeekStart(weekStartOf(today));
      setDay(today);
    }
  }
  function moveWeek(n) {
    if (!okToLeave()) return;
    const ws = addDays(weekStart, 7 * n);
    setWeekStart(ws);
    setDay(ws <= today && today <= addDays(ws, 6) ? today : ws);
    selectOne(null);
  }
  function switchChannel(id) {
    if (!okToLeave()) return;
    setChannelId(id);
    selectOne(null);
    setPicked(null);
  }
  function pickDay(key, id) {
    setDay(key);
    selectOne(id || null);
    if (id) setPicked(null);
  }

  /* ---------- the draft ---------- */

  const dayKeys = useMemo(() => (layer === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : DAYS), [layer, weekStart]);
  const daySlots = useMemo(() => (draft[day] || []).slice().sort((a, b) => a.start - b.start), [draft, day]);
  const savedById = useMemo(() => Object.fromEntries(((data && data.slots) || []).map((s) => [s.id, s])), [data]);
  const selected = daySlots.find((s) => s.id === selectedId) || null;
  const selectedSlots = daySlots.filter((s) => selection.has(s.id));
  const seriesById = useMemo(() => Object.fromEntries((library ? library.series : []).map((s) => [s.id, s])), [library]);
  const isPastDay = layer === 'week' && day < today;
  const isToday = layer === 'week' ? day === today : day === weekdayOfDate(today);
  const ghostsFor = (key) => (layer === 'week' && data && data.defaults ? (data.defaults[weekdayOfDate(key)] || []) : []);
  const dayTabs = layer === 'week'
    ? dayKeys.map((d) => ({ key: d, label: `${DAY_SHORT[weekdayOfDate(d)]} ${dateParts(d).getUTCDate()}`, isToday: d === today, past: d < today }))
    : DAYS.map((d) => ({ key: d, label: DAY_SHORT[d], isToday: d === weekdayOfDate(today), past: false }));
  const dayLabel = (key) => { const t = dayTabs.find((x) => x.key === key); return t ? t.label : key; };
  const weekIsCurrent = weekStart === weekStartOf(today);

  // Every change to the draft goes through here, so it can be undone.
  function edit(nextDraft, keys, msg, select) {
    setHistory((h) => [...h.slice(-49), { draft, dirty: new Set(dirty), selection }]);
    setDraft(nextDraft);
    setDirty((d) => new Set([...d, ...keys]));
    if (select !== undefined) selectOne(select);
    setError(null);
    if (msg) flash(msg, true);
  }
  function undo() {
    const last = history[history.length - 1];
    if (!last) return flash('Nothing to undo');
    setHistory((h) => h.slice(0, -1));
    setDraft(last.draft);
    setDirty(last.dirty);
    setSelection(last.selection || new Set());
    setError(null);
    return flash('Undone');
  }
  const withDay = (key, slots) => ({ ...draft, [key]: slots });
  const removedNote = (removed) => (removed && removed.length ? ` · ${plural(removed.length, 'ad break')} didn't fit anymore and came off` : '');
  const movedNote = (moved) => (moved && moved.length ? `, and the ${plural(moved.length, 'block')} after it moved along` : '');

  // What a library item becomes when it lands on the day.
  function slotFor(item, start) {
    const base = { id: newTmpId(), layer, airDate: layer === 'week' ? day : null, dayOfWeek: layer === 'default' ? day : null, start, episodeId: null, mediaId: null, seriesId: null, pinEpisodeId: null, pinLabel: null, rerunOf: null, title: item.name, tier: item.tier || null, unavailable: false };
    if (item.type === 'title') return { ...base, kind: 'episode', episodeId: item.id, durationSeconds: Math.ceil(item.durationSeconds / 60) * 60, runtimeSeconds: item.durationSeconds };
    if (item.type === 'series') {
      const s = seriesById[item.id];
      return { ...base, kind: layer === 'default' ? 'series_continue' : 'series_pinned', seriesId: item.id, pinEpisodeId: layer === 'default' ? null : s.episodes[0].id, pinLabel: layer === 'default' ? null : (s.episodes[0].label || s.episodes[0].title), durationSeconds: defaultSeriesLength(s.episodes, 0), title: s.name };
    }
    if (item.type === 'media') return { ...base, kind: 'media', mediaId: item.id, durationSeconds: Math.ceil(item.durationSeconds / 60) * 60, runtimeSeconds: item.durationSeconds };
    if (item.type === 'ad_break') return { ...base, kind: 'ad_break', durationSeconds: 120, title: 'Ad break' };
    if (item.type === 'live') return { ...base, kind: 'live', durationSeconds: 3600, title: 'Live broadcast' };
    return null;
  }

  function place(item, sec, opts = {}) {
    if (!item) return flash('Pick something from the library first');
    if (isPastDay) return flash('This day already aired');
    const slot = slotFor(item, 0);
    if (!slot) return null;
    slot.start = magnetStart(Math.max(0, Math.min(DAY_SECONDS - slot.durationSeconds, snapToGrid(sec))), slot.durationSeconds, daySlots, adGap);
    if (opts.ripple) {
      // Make room: everything from here on moves later by the new block's length.
      const r = insertWithRipple(daySlots, slot, adGap);
      if (r.problem) return flash(`${item.name} needs ${dur(slot.durationSeconds)}. ${r.problem}`);
      setPicked(null);
      edit(withDay(day, r.slots), [day], `Added at ${clock(slot.start)}${movedNote(r.moved)}`, slot.id);
      return slot.id;
    }
    const res = arrange(daySlots.concat([slot]), { id: slot.id, start: slot.start, durationSeconds: slot.durationSeconds });
    const problem = dayProblem(res.slots, [slot.id]);
    if (problem) return flash(`${item.name} needs ${dur(slot.durationSeconds)}. ${problem}`);
    setPicked(null);
    edit(withDay(day, res.slots), [day], `Added at ${clock(slot.start)}${removedNote(res.removed)}`, slot.id);
    return slot.id;
  }

  function onArrange(slots, info) {
    if (!slots) return flash(info.error);
    return edit(withDay(day, slots), [day], `${info.msg}${removedNote(info.removed)}`, info.select);
  }

  // Blocks dropped on another day's row: same times, that day.
  function moveToDay(ids, key) {
    const moving = daySlots.filter((s) => ids.includes(s.id));
    if (!moving.length || key === day) return undefined;
    if (layer === 'week' && key < today) return flash('That day already aired');
    if (moving.some((s) => s.kind === 'series_rerun' || daySlots.some((o) => o.rerunOf === s.id && !ids.includes(o.id)))) return flash('Reruns stay with the block they copy. Move them together, or change the rerun first.');
    const carried = moving.map((s) => ({ ...s, airDate: layer === 'week' ? key : null, dayOfWeek: layer === 'default' ? key : null }));
    const target = (draft[key] || []).filter((o) => !ids.includes(o.id));
    const res = arrangeMany(target.concat(carried), carried.map((s) => ({ id: s.id, start: s.start, durationSeconds: s.durationSeconds })));
    const problem = dayProblem(res.slots, ids);
    if (problem) return flash(`No room on ${dayLabel(key)}. ${problem}`);
    const msg = moving.length === 1 ? `Moved to ${dayLabel(key)} at ${clock(moving[0].start)}` : `Moved ${plural(moving.length, 'block')} to ${dayLabel(key)}`;
    return edit({ ...draft, [day]: daySlots.filter((o) => !ids.includes(o.id)), [key]: res.slots }, [day, key], `${msg}${removedNote(res.removed)}`, null);
  }

  // A bar dragged in the week strip: a new time, maybe a new day.
  function moveBar(result, problem) {
    if (!result) return flash(problem);
    const { id, fromKey, toKey, start, slots, removed } = result;
    const s = (draft[fromKey] || []).find((x) => x.id === id);
    if (!s) return null;
    const next = { ...draft };
    if (toKey !== fromKey) next[fromKey] = (draft[fromKey] || []).filter((x) => x.id !== id);
    next[toKey] = slots.map((x) => (x.id === id ? { ...x, airDate: layer === 'week' ? toKey : null, dayOfWeek: layer === 'default' ? toKey : null } : x));
    const msg = toKey === fromKey ? `Moved to ${clock(start)}` : `Moved to ${dayLabel(toKey)} at ${clock(start)}`;
    if (toKey !== day) setDay(toKey);
    return edit(next, toKey === fromKey ? [toKey] : [fromKey, toKey], `${msg}${removedNote(removed)}`, id);
  }

  // Edits from the side panel. Returns an error message, or null when applied.
  function changeSlot(id, changes, msg) {
    const s = daySlots.find((x) => x.id === id);
    if (!s) return 'That slot is gone.';
    const next = { ...s, ...changes };
    const lim = limitFor(next);
    if (lim && (next.durationSeconds < lim.min || next.durationSeconds > lim.max)) return `That block has to be ${lim.label}.`;
    if (next.start + next.durationSeconds > DAY_SECONDS) return `That runs past midnight (it would end at ${clock(next.start + next.durationSeconds)}). Start it earlier, or put the rest on the next day.`;
    const others = daySlots.map((o) => (o.id === id ? next : o));
    const res = arrange(others, { id, start: next.start, durationSeconds: next.durationSeconds });
    const problem = dayProblem(res.slots, [id]);
    if (problem) return problem;
    edit(withDay(day, res.slots), [day], `${msg || 'Updated'}${removedNote(res.removed)}`);
    return null;
  }

  function nudge(delta, withRipple = false) {
    const group = selectedSlots.filter((s) => !(s.kind === 'live' && !canLive));
    if (!group.length || isPastDay) return undefined;
    if (group.length > 1) {
      const lo = Math.min(...group.map((g) => g.start));
      const hi = Math.max(...group.map((g) => g.start + g.durationSeconds));
      const d = Math.max(-lo, Math.min(DAY_SECONDS - hi, delta));
      if (!d) return undefined;
      const res = arrangeMany(daySlots, group.map((g) => ({ id: g.id, start: g.start + d, durationSeconds: g.durationSeconds })));
      const problem = dayProblem(res.slots, group.map((g) => g.id));
      if (problem) return flash(problem);
      return edit(withDay(day, res.slots), [day], `Moved ${plural(group.length, 'block')}, the first now at ${clock(lo + d)}${removedNote(res.removed)}`);
    }
    const s = group[0];
    const start = Math.max(0, Math.min(DAY_SECONDS - s.durationSeconds, s.start + delta));
    if (start === s.start) return undefined;
    if (withRipple) {
      const r = ripple(daySlots, { id: s.id, start, durationSeconds: s.durationSeconds }, { start: s.start, durationSeconds: s.durationSeconds });
      if (r.problem) return flash(r.problem);
      return edit(withDay(day, r.slots), [day], `Moved to ${clock(start)}${movedNote(r.moved)}`);
    }
    const err = changeSlot(s.id, { start }, `Moved to ${clock(start)}`);
    return err ? flash(err) : undefined;
  }

  function removeSelected() {
    const ids = selectedSlots.filter((s) => !(s.kind === 'live' && !canLive)).map((s) => s.id);
    if (!ids.length || isPastDay) return;
    const reruns = daySlots.filter((o) => o.rerunOf && ids.includes(o.rerunOf) && !ids.includes(o.id));
    if (reruns.length && !window.confirm(`Removing this also removes ${plural(reruns.length, 'rerun')} of it. Continue?`)) return;
    const gone = new Set([...ids, ...reruns.map((r) => r.id)]);
    const what = ids.length === 1 ? 'Removed' : `Removed ${plural(ids.length, 'block')}`;
    edit(withDay(day, daySlots.filter((o) => !gone.has(o.id))), [day], reruns.length ? `${what}, with ${plural(reruns.length, 'rerun')}` : what, null);
  }

  function duplicateSlot(id) {
    const s = daySlots.find((x) => x.id === id);
    if (!s || isPastDay) return undefined;
    const copy = { ...s, id: newTmpId(), rerunOf: null, kind: s.kind === 'series_rerun' ? 'series_pinned' : s.kind };
    if (copy.kind === 'series_pinned' && !copy.pinEpisodeId && seriesById[copy.seriesId]) copy.pinEpisodeId = seriesById[copy.seriesId].episodes[0].id;
    const start = firstRoomAfter(daySlots, s.start + s.durationSeconds, copy.durationSeconds, isHard(copy) ? adGap : 0);
    if (start === null) return flash('No room later today for a copy');
    copy.start = start;
    const res = arrange(daySlots.concat([copy]), { id: copy.id, start, durationSeconds: copy.durationSeconds });
    return edit(withDay(day, res.slots), [day], `Copied to ${clock(start)}${removedNote(res.removed)}`, copy.id);
  }

  // Space the open day out so every show has the ad gap after it.
  function spaceOutDay() {
    if (isPastDay || !adGap) return undefined;
    const r = spaceOut(daySlots, adGap);
    if (r.problem) return flash(r.problem);
    if (!r.moved.length) return flash(`Every show already has ${dur(adGap)} after it`);
    return edit(withDay(day, r.slots), [day], `Spaced out: ${plural(r.moved.length, 'block')} moved so every show has ${dur(adGap)} of ads after it`);
  }

  async function changeAdGap(seconds) {
    const before = adGap;
    setAdGap(seconds);
    try {
      await api('/api/schedule/settings', 'POST', { channelId, adGapSeconds: seconds });
      flash(seconds ? `Shows now land ${dur(seconds)} apart` : 'Shows now butt up with no gap');
    } catch (err) {
      setAdGap(before);
      setError(err.message);
    }
  }

  // Copies one day's lineup onto other days of this view, replacing what they had.
  function copyDayTo(targets) {
    const source = daySlots.filter((s) => s.kind !== 'live' || canLive);
    const next = { ...draft };
    for (const key of targets) {
      const idMap = {};
      const kept = (draft[key] || []).filter((s) => s.kind === 'live' && !canLive);
      const copies = [];
      for (const s of source) {
        const c = { ...s, id: newTmpId(), airDate: layer === 'week' ? key : null, dayOfWeek: layer === 'default' ? key : null };
        idMap[s.id] = c.id;
        copies.push(c);
      }
      for (const c of copies) if (c.rerunOf) c.rerunOf = idMap[c.rerunOf] || null;
      next[key] = kept.concat(copies.filter((c) => c.kind !== 'series_rerun' || c.rerunOf)).sort((a, b) => a.start - b.start);
    }
    edit(next, targets, `Copied to ${plural(targets.length, 'day')}`);
  }

  /* ---------- saving ---------- */

  async function save() {
    if (!isDirty || saving) return true;
    setSaving(true);
    setError(null);
    try {
      const days = Object.fromEntries([...dirty].map((k) => [k, (draft[k] || []).map((s) => Object.fromEntries(SAVE_FIELDS.map((f) => [f, s[f] ?? null])))]));
      const out = await api('/api/schedule/save', 'POST', { channelId, layer, days });
      if (out.ids) setSelection(new Set([...selection].map((id) => out.ids[id] || id)));
      forgetStoredDraft();
      await loadView();
      flash('Schedule saved');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function discard() {
    if (!isDirty || !window.confirm('Throw away your unsaved changes?')) return;
    selectOne(null);
    forgetStoredDraft();
    loadView();
  }
  async function togglePublish() {
    if (!data) return;
    setBusy(true);
    try {
      if (isDirty && !(await save())) return;
      await api('/api/schedule/publish', 'POST', { channelId, weekStart, published: !data.published });
      await loadView();
      flash(data.published ? 'Week unpublished. The default schedule runs.' : 'Week published');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function resetBookmark(id) {
    if (!window.confirm('Start this block over from the first episode?')) return;
    setBusy(true);
    try {
      await api('/api/schedule/slots', 'PATCH', { channelId, id, resetBookmark: true });
      await loadView();
      flash('Back to the first episode');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Keyboard: arrows nudge (Alt = ripple, Shift = 30 min), Delete removes,
  // Esc deselects, Ctrl+Z undoes, Ctrl+S saves.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = ['input', 'select', 'textarea'].includes(tag);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
      if (typing || view === 'loop') return;
      if (e.key === 'Escape') { selectOne(null); setPicked(null); return; }
      if (!selection.size) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); nudge(e.shiftKey ? -1800 : -SNAP_SECONDS, e.altKey); }
      if (e.key === 'ArrowDown') { e.preventDefault(); nudge(e.shiftKey ? 1800 : SNAP_SECONDS, e.altKey); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <Head>
        <title>{`Scheduler — ${channel ? channel.name : 'Channels'} — ${SITE.name}`}</title>
      </Head>
      <HeaderNav activeType="All" isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main className="stage stage-single stage-wide sch-page">
        <div className="sch-phone">
          <div className="eyebrow">Scheduler</div>
          <h1>{channel.name} <span className="sch-chnum">CH {pad(channel.number)}</span></h1>
          <p>The scheduler is built for a tablet or computer. Open this page on a bigger screen to plan {channel.name}.</p>
          {channel.visibility === 'public' && <Link href={`/live/${channel.slug}`} className="sch-btn">Watch it live ↗</Link>}
        </div>

        <div className="sch-work">
        <div className="sch-head">
          <div>
            <div className="eyebrow">Scheduler</div>
            <h1>{channel.name} <span className="sch-chnum">CH {pad(channel.number)}</span></h1>
          </div>
          <div className="sch-head-ctrls">
            {channels.length > 1 && (
              <label className="sch-field">
                <span>Channel</span>
                <select id="sch-channel" value={channelId} onChange={(e) => switchChannel(e.target.value)}>
                  {channels.map((c) => <option key={c.id} value={c.id}>CH {pad(c.number)} · {c.name}{c.visibility === 'draft' ? ' (draft)' : ''}</option>)}
                </select>
              </label>
            )}
            <div className="sch-seg" role="tablist" aria-label="View">
              {[['week', 'This week'], ['default', 'Default schedule'], ['loop', 'Loop']].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => switchView(k)}>{label}</button>
              ))}
            </div>
            {view !== 'loop' && (
              <div className="sch-zoom" role="group" aria-label="Zoom the day" title="Ctrl + scroll over the day also zooms">
                <button type="button" className="sch-btn" onClick={() => zoomBy(-1)} disabled={zoomIdx === 0} aria-label="Zoom out">−</button>
                <span>Zoom</span>
                <button type="button" className="sch-btn" onClick={() => zoomBy(1)} disabled={zoomIdx === ZOOM_LEVELS.length - 1} aria-label="Zoom in">+</button>
              </div>
            )}
            {channel.visibility === 'public' && <Link href={`/live/${channel.slug}`} className="sch-btn">Watch it live ↗</Link>}
          </div>
        </div>

        <div className="sch-order" aria-label="What airs, in priority order">
          <span className="sch-order-label">What airs</span>
          <span className="sch-pill live">1 · Live broadcast</span><span aria-hidden="true">→</span>
          <span className={`sch-pill ${view === 'week' ? 'on' : ''}`}>2 · Published week</span><span aria-hidden="true">→</span>
          <span className={`sch-pill ${view === 'default' ? 'on' : ''}`}>3 · Default schedule</span><span aria-hidden="true">→</span>
          <span className={`sch-pill loop ${view === 'loop' ? 'on' : ''}`}>4 · Loop, for whatever&rsquo;s left</span>
        </div>

        {error && <div className="house-ad-error" role="alert" style={{ marginBottom: '0.8rem' }}>{error}</div>}

        {view === 'loop' ? (
          <LoopView channelId={channelId} loop={loop} library={library} busy={busy} setBusy={setBusy} setError={setError} reload={loadLoop} flash={flash} />
        ) : (
          <>
            <div className="sch-bar">
              {layer === 'week' ? (
                <div className="sch-week">
                  <button type="button" className="sch-btn" onClick={() => moveWeek(-1)} aria-label="Previous week" disabled={weekIsCurrent}>◀</button>
                  <strong>{shortDate(weekStart)} – {shortDate(addDays(weekStart, 6))}</strong>
                  <button type="button" className="sch-btn" onClick={() => moveWeek(1)} aria-label="Next week">▶</button>
                  {data && (data.published
                    ? <span className="sch-pill ok">Published · airing</span>
                    : <span className="sch-pill warn">Not published · the default schedule runs</span>)}
                </div>
              ) : (
                <p className="sch-note">The default schedule runs on any day whose week isn&rsquo;t published. Series blocks here can pick up where they left off.</p>
              )}
              <div className="sch-bar-acts">
                <CopyDay key={`${view}-${day}`} layer={layer} day={day} tabs={dayTabs} busy={busy || saving} onCopy={copyDayTo} />
                {isDirty && <button type="button" className="sch-btn" onClick={discard} disabled={saving}>Discard</button>}
                <button type="button" className={`sch-btn ${isDirty ? 'primary' : ''}`} onClick={save} disabled={!isDirty || saving} title="Ctrl+S">
                  {saving ? 'Saving…' : isDirty ? `Save schedule · ${plural(dirty.size, 'day')}` : 'Saved'}
                </button>
                {layer === 'week' && data && (
                  <button type="button" className={data.published ? 'sch-btn' : 'sch-btn primary'} disabled={busy || saving} onClick={togglePublish}>
                    {data.published ? (isDirty ? 'Save & keep published' : 'Unpublish week') : (isDirty ? 'Save & publish week' : 'Publish week')}
                  </button>
                )}
              </div>
            </div>

            {recoverable && !isDirty && (
              <div className="sch-recover" role="status">
                <span>You left unsaved changes here {new Date(recoverable.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</span>
                <button type="button" className="sch-btn primary" onClick={restoreDraft}>Bring them back</button>
                <button type="button" className="sch-btn" onClick={forgetStoredDraft}>Throw them away</button>
              </div>
            )}

            <ScheduleWeekStrip
              days={dayTabs}
              draft={draft}
              ghostsFor={ghostsFor}
              selectedDay={day}
              selectedIds={selection}
              dirty={dirty}
              hoverDay={hoverTab}
              nowSec={nowSec}
              canLive={canLive}
              adGap={adGap}
              onPickDay={(k) => pickDay(k)}
              onPickSlot={(k, id) => pickDay(k, id)}
              onMoveBar={moveBar}
            />

            <div className="sch-grid">
              <Library library={library} media={media} reloadMedia={loadMedia} channelId={channelId} setError={setError} layer={layer} canLive={canLive} picked={picked} setPicked={(p) => { setPicked(p); if (p) selectOne(null); }} />

              {data ? (
                <ScheduleTimeline
                  key={`${channelId}-${view}-${day}-${weekStart}`}
                  slots={daySlots}
                  ghosts={ghostsFor(day)}
                  seriesById={seriesById}
                  layer={layer}
                  px={px}
                  picked={picked}
                  selectedIds={selection}
                  canLive={canLive}
                  isPastDay={isPastDay}
                  isToday={isToday}
                  nowSec={nowSec}
                  adGap={adGap}
                  onSelect={(id, opts) => {
                    setPicked(null);
                    if (opts && opts.toggle) setSelection((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
                    else selectOne(id);
                  }}
                  onPlace={place}
                  onArrange={onArrange}
                  onMoveToDay={moveToDay}
                  onTabHover={setHoverTab}
                  onAdGapChange={changeAdGap}
                  onSpaceOut={spaceOutDay}
                  onZoom={zoomBy}
                  needPick={() => flash('Pick something from the library first')}
                />
              ) : (
                <div className="sch-timeline"><div className="sch-muted" style={{ padding: '1rem' }}>Loading…</div></div>
              )}

              <aside className="sch-insp" aria-live="polite">
                {picked ? (
                  <PickedInfo picked={picked} layer={layer} onCancel={() => setPicked(null)} />
                ) : selectedSlots.length > 1 ? (
                  <GroupPanel slots={selectedSlots} isPastDay={isPastDay} onClear={() => selectOne(null)} onRemove={removeSelected} />
                ) : selected ? (
                  <SlotEditor
                    key={selected.id}
                    slot={selected}
                    layer={layer}
                    daySlots={daySlots}
                    series={selected.seriesId ? seriesById[selected.seriesId] : null}
                    preview={data && data.preview ? data.preview[selected.id] : null}
                    unchanged={sameSlot(selected, savedById[selected.id])}
                    isDirty={isDirty}
                    canLive={canLive}
                    isPastDay={isPastDay}
                    adGap={adGap}
                    busy={busy || saving}
                    onChange={(changes, msg) => changeSlot(selected.id, changes, msg)}
                    onRemove={removeSelected}
                    onDuplicate={() => duplicateSlot(selected.id)}
                    onResetBookmark={() => resetBookmark(selected.id)}
                  />
                ) : (
                  <div className="sch-empty-insp">
                    <div className="tv-info-eyebrow">Slot</div>
                    <p>Pick something from the library, then click an open stretch or drag it onto the day. Click a block to edit it, drag it to move it, pull its bottom edge to change its length. Shift-click to select several and move them together.</p>
                    <p className="sch-tz">All times are Pacific, the same for every viewer. Changes land when you save the schedule.</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
        </div>
        {toast && (
          <div className="sch-toast" role="status">
            <span>{toast.msg}</span>
            {toast.canUndo && history.length > 0 && <button type="button" onClick={undo}>Undo</button>}
          </div>
        )}
      </main>
      <Footer />
      <MobileTabBar />
    </>
  );
}

/* ---------------- library ---------------- */

function Library({ library, media, reloadMedia, channelId, setError, layer, canLive, picked, setPicked }) {
  const [tab, setTab] = useState('series');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const query = q.trim().toLowerCase();
  const isPicked = (type, id) => picked && picked.type === type && picked.id === id;
  const drag = (item) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; setPicked(item); }
  });

  return (
    <div className="sch-lib">
      <div className="sch-seg sch-seg-sm" role="tablist" aria-label="Library">
        {[['series', 'Series'], ['titles', 'Titles'], ['uploads', 'Uploads'], ['breaks', 'Breaks']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {(tab === 'series' || tab === 'titles') && <input id="sch-search" type="search" className="sch-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />}
      {(tab === 'series' || tab === 'titles') && <p className="sch-lib-note">Only titles their creators opted in to channels show up here. Premium titles air with ads.</p>}
      {tab === 'uploads' && <Uploads media={media} reload={reloadMedia} channelId={channelId} setError={setError} picked={picked} setPicked={setPicked} drag={drag} />}
      {tab !== 'uploads' && (
      <div className="sch-items">
        {!library && tab !== 'breaks' && <div className="sch-muted">Loading…</div>}
        {library && tab === 'series' && library.series.filter((s) => !query || s.name.toLowerCase().includes(query)).map((s) => {
          const item = { type: 'series', id: s.id, name: s.name, tier: s.tiers.includes('premium') ? 'premium' : null };
          return (
            <div key={s.id} className={`sch-item ${isPicked('series', s.id) ? 'picked' : ''}`}>
              <button type="button" className="sch-item-main" onClick={() => setPicked(isPicked('series', s.id) ? null : item)} {...drag(item)}>
                <span className="sch-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : undefined} />
                <span className="sch-item-text">
                  <b>{s.name}</b>
                  <small>{s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'} · drops in at one episode ({dur(defaultSeriesLength(s.episodes, 0))})</small>
                  <span className="sch-chips">
                    <span className="sch-chip series">{layer === 'default' ? '⟳ Continue' : '▣ Pinned'}</span>
                    {s.tiers.includes('premium') && <span className="sch-chip prem">Premium · ads</span>}
                  </span>
                </span>
              </button>
              <button type="button" className="sch-expand" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                {open === s.id ? 'Hide episodes' : 'Single episodes'}
              </button>
              {open === s.id && (
                <div className="sch-eps">
                  {s.episodes.map((e) => {
                    const epItem = { type: 'title', id: e.id, name: `${s.name} · ${e.label || e.title}`, durationSeconds: e.durationSeconds, tier: e.tier };
                    return (
                      <button key={e.id} type="button" className={`sch-ep ${isPicked('title', e.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked('title', e.id) ? null : epItem)} {...drag(epItem)}>
                        <span>{e.label ? `${e.label} · ` : ''}{e.title}</span><small>{dur(e.durationSeconds)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {library && tab === 'series' && library.series.length === 0 && <div className="sch-muted">No series are opted in to channels yet.</div>}

        {library && tab === 'titles' && library.titles.filter((t) => !query || t.title.toLowerCase().includes(query)).map((t) => {
          const item = { type: 'title', id: t.id, name: t.title, durationSeconds: t.durationSeconds, tier: t.tier };
          return (
            <button key={t.id} type="button" className={`sch-item sch-item-main ${isPicked('title', t.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked('title', t.id) ? null : item)} {...drag(item)}>
              <span className="sch-thumb" style={t.thumbnail ? { backgroundImage: `url(${t.thumbnail})` } : undefined} />
              <span className="sch-item-text">
                <b>{t.title}</b>
                <small>{dur(t.durationSeconds)}{t.contentType ? ` · ${t.contentType === 'movie' ? 'film' : t.contentType}` : ''}</small>
                {t.tier === 'premium' && <span className="sch-chips"><span className="sch-chip prem">Premium · ads</span></span>}
              </span>
            </button>
          );
        })}
        {library && tab === 'titles' && library.titles.length === 0 && <div className="sch-muted">No standalone titles are opted in to channels yet.</div>}

        {tab === 'breaks' && (
          <>
            {[{ type: 'ad_break', id: 'ad', name: 'Ad break', sub: '2 min to start · pull its edge to change', cls: 'ads' }, ...(canLive ? [{ type: 'live', id: 'live', name: 'Live broadcast', sub: 'A placeholder in the guide. If nobody goes live, the loop plays.', cls: 'live' }] : [])].map((b) => (
              <button key={b.id} type="button" className={`sch-item sch-item-main ${isPicked(b.type, b.id) ? 'picked' : ''}`} onClick={() => setPicked(isPicked(b.type, b.id) ? null : b)} {...drag(b)}>
                <span className={`sch-thumb ${b.cls}`} />
                <span className="sch-item-text"><b>{b.name}</b><small>{b.sub}</small></span>
              </button>
            ))}
          </>
        )}
      </div>
      )}
    </div>
  );
}

/* ---------------- uploads ---------------- */

const MEDIA_KINDS = [['bumper', 'Bumper'], ['station_id', 'Station ID'], ['promo', 'Promo'], ['show', 'Show']];
const MEDIA_STATUS = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Not approved' };

function Uploads({ media, reload, channelId, setError, picked, setPicked, drag }) {
  const { activeUpload, startUpload } = useUpload();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('bumper');
  const [where, setWhere] = useState('channels');
  const [formError, setFormError] = useState(null);
  const uploading = !!activeUpload && ['requesting-url', 'uploading', 'saving'].includes(activeUpload.status);

  // The upload widget does the transfer; refresh the list once it lands.
  const lastStatus = useRef(null);
  useEffect(() => {
    const st = activeUpload ? activeUpload.status : null;
    if (st === 'done' && lastStatus.current && lastStatus.current !== 'done') reload();
    lastStatus.current = st;
  }, [activeUpload, reload]);

  function submit(e) {
    e.preventDefault();
    setFormError(null);
    if (!file) return setFormError('Choose a video file.');
    if (!title.trim()) return setFormError('Give it a title.');
    startUpload(file, { channelId, title: title.trim(), kind }, undefined, 'tus', '/api/schedule/media', {
      label: 'Uploaded for review',
      meta: 'An admin reviews channel uploads before they can air.'
    }).catch((err) => setFormError(err.message));
    setOpen(false);
    setFile(null);
    setTitle('');
    return undefined;
  }

  async function remove(m) {
    if (!window.confirm(`Delete "${m.title}"? It also comes off every schedule it's on.`)) return;
    try {
      await api('/api/schedule/media', 'DELETE', { channelId, id: m.id });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="sch-items">
      {!open && (
        <button type="button" className="sch-btn" onClick={() => setOpen(true)} disabled={uploading}>
          {uploading ? 'Uploading… (see the progress box)' : '+ Upload a bumper, ID or show'}
        </button>
      )}
      {formError && !open && <div className="house-ad-error" role="alert">{formError}</div>}
      {open && (
        <form className="sch-upform" onSubmit={submit}>
          <label className="sch-field"><span>Video</span><input id="sch-up-file" type="file" accept="video/*" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
          <label className="sch-field"><span>Title</span><input id="sch-up-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="TapaTV 10 PM station ID" /></label>
          <label className="sch-field">
            <span>What is it</span>
            <select id="sch-up-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {MEDIA_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <fieldset className="sch-field sch-where">
            <span>Where can it play</span>
            <label>
              <input type="radio" name="sch-where" checked={where === 'channels'} onChange={() => setWhere('channels')} />
              <span><b>Channels only</b><small>Stays in your uploads here. Never shows up on-demand.</small></span>
            </label>
            <label>
              <input type="radio" name="sch-where" checked={where === 'ondemand'} onChange={() => setWhere('ondemand')} />
              <span><b>Channels and on-demand</b><small>Joins the on-demand library after the usual review.</small></span>
            </label>
          </fieldset>
          {where === 'ondemand' ? (
            <p className="sch-muted">
              Submit it in <Link href="/creator">Creator Studio</Link> like any title and tick &ldquo;Let channels air this&rdquo;.
              Once it&rsquo;s approved it shows up under Series or Titles here.
            </p>
          ) : (
            <p className="sch-muted">An admin reviews it before it can be scheduled.</p>
          )}
          {formError && <div className="house-ad-error" role="alert">{formError}</div>}
          <div className="sch-editor-acts">
            {where === 'channels' && <button type="submit" className="sch-btn primary" disabled={uploading}>Upload for review</button>}
            <button type="button" className="sch-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {!media && <div className="sch-muted">Loading…</div>}
      {media && media.length === 0 && !open && <div className="sch-muted">No uploads yet.</div>}
      {media && media.map((m) => {
        const ready = m.status === 'approved' && !m.held && !!m.durationSeconds;
        const item = { type: 'media', id: m.id, name: m.title, durationSeconds: m.durationSeconds };
        const isPicked = !!picked && picked.type === 'media' && picked.id === m.id;
        return (
          <div key={m.id} className={`sch-item ${isPicked ? 'picked' : ''}`}>
            <button
              type="button"
              className="sch-item-main"
              aria-disabled={!ready}
              onClick={() => ready && setPicked(isPicked ? null : item)}
              {...(ready ? drag(item) : {})}
              style={ready ? undefined : { cursor: 'default' }}
            >
              <span className="sch-thumb" style={m.thumbnail ? { backgroundImage: `url(${m.thumbnail})` } : undefined} />
              <span className="sch-item-text">
                <b>{m.title}</b>
                <small>{m.kindLabel}{m.durationSeconds ? ` · ${dur(m.durationSeconds)}` : ' · processing'}</small>
                <span className="sch-chips">
                  <span className={`sch-chip ${m.held ? 'bad' : m.status === 'approved' ? 'ok' : m.status === 'rejected' ? 'bad' : 'wait'}`}>{m.held ? 'Pulled for review' : MEDIA_STATUS[m.status]}</span>
                  <span className="sch-chip">Channels only</span>
                </span>
                {m.status === 'rejected' && m.rejectionReason && <small className="sch-reject">Admin&rsquo;s note: {m.rejectionReason}</small>}
              </span>
            </button>
            <button type="button" className="sch-expand" onClick={() => remove(m)}>Delete</button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- side panel ---------------- */

function PickedInfo({ picked, layer, onCancel }) {
  return (
    <div className="sch-editor">
      <div className="tv-info-eyebrow">Ready to place</div>
      <h3>{picked.name}</h3>
      <p>
        {picked.type === 'series'
          ? `Drops in as a ${layer === 'default' ? 'Continue' : 'Pinned'} block one episode long. Pull its bottom edge or use the fit buttons for more.`
          : picked.durationSeconds ? `${dur(picked.durationSeconds)}, in a ${dur(Math.ceil(picked.durationSeconds / 60) * 60)} slot. ` : ''}
        Click an open stretch of the day, or drag it on.
      </p>
      <button type="button" className="sch-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function GroupPanel({ slots, isPastDay, onClear, onRemove }) {
  const sorted = slots.slice().sort((a, b) => a.start - b.start);
  return (
    <div className="sch-editor">
      <div className="tv-info-eyebrow">{plural(slots.length, 'block')} selected</div>
      <div className="sch-group-list">
        {sorted.map((s) => <div key={s.id}><span>{KIND_ICON[s.kind] ? `${KIND_ICON[s.kind]} ` : ''}{s.title}</span><span>{clock(s.start)}</span></div>)}
      </div>
      <p>Drag any of them to move them all together, or use the arrow keys. Shift-click a block to add or remove it.</p>
      <div className="sch-editor-acts">
        <button type="button" className="sch-btn" onClick={onClear}>Clear selection</button>
        {!isPastDay && <button type="button" className="sch-btn danger" onClick={onRemove}>Remove all {slots.length}</button>}
      </div>
    </div>
  );
}

function SlotEditor({ slot, layer, daySlots, series, preview, unchanged, isDirty, canLive, isPastDay, adGap, busy, onChange, onRemove, onDuplicate, onResetBookmark }) {
  const [start, setStart] = useState(hhmm(slot.start));
  const [minutes, setMinutes] = useState(String(Math.round(slot.durationSeconds / 60)));
  const [seconds, setSeconds] = useState(String(slot.durationSeconds));
  const [title, setTitle] = useState(slot.title || '');
  const [formError, setFormError] = useState(null);
  const isSeries = SERIES_KINDS.includes(slot.kind);
  const locked = isPastDay || (slot.kind === 'live' && !canLive);
  const lengthEditable = !hasFixedLength(slot) && !locked;
  const eps = series ? series.episodes : [];
  const isTemp = String(slot.id).startsWith('tmp-');

  // Keep the fields in step with drags on the timeline.
  useEffect(() => {
    setStart(hhmm(slot.start));
    setMinutes(String(Math.round(slot.durationSeconds / 60)));
    setSeconds(String(slot.durationSeconds));
    setFormError(null);
  }, [slot.start, slot.durationSeconds]);

  const startSec = /^\d{2}:\d{2}$/.test(start) ? Number(start.slice(0, 2)) * 3600 + Number(start.slice(3)) * 60 : NaN;
  const lenSec = !lengthEditable ? slot.durationSeconds : slot.kind === 'ad_break' ? Number(seconds) : Number(minutes) * 60;
  const timeChanged = Number.isFinite(startSec) && startSec !== slot.start;
  const lenChanged = lengthEditable && Number.isFinite(lenSec) && lenSec !== slot.durationSeconds;
  const titleChanged = slot.kind === 'live' && title !== slot.title;
  const fit = isSeries && eps.length ? fitSummary(slot, eps, daySlots) : null;
  const sources = daySlots.filter((s) => s.id !== slot.id && s.seriesId === slot.seriesId && (s.kind === 'series_continue' || s.kind === 'series_pinned') && s.start < slot.start);
  const upcoming = preview && unchanged ? Object.entries(preview).slice(0, 4) : [];
  const edges = isSeries && eps.length && slot.kind !== 'series_rerun' ? episodeEdges(eps, Math.max(0, eps.findIndex((e) => e.id === slot.pinEpisodeId))) : [];
  const lim = limitFor(slot);
  // The block right before this one, to butt up against (with the ad gap, or flush).
  const prev = daySlots.filter((s) => s.id !== slot.id && s.start < slot.start).sort((a, b) => b.start - a.start)[0] || null;
  const prevEnd = prev ? prev.start + prev.durationSeconds : null;
  const afterPrev = prev ? prevEnd + (isHard(prev) && isHard(slot) ? adGap : 0) : null;

  function apply() {
    const changes = {};
    if (!Number.isFinite(startSec)) return setFormError('Pick a start time.');
    if (lengthEditable && !Number.isFinite(lenSec)) return setFormError('Give it a length.');
    if (lengthEditable && lim && (lenSec < lim.min || lenSec > lim.max)) return setFormError(`That block has to be ${lim.label}.`);
    if (timeChanged) changes.start = startSec;
    if (lenChanged) changes.durationSeconds = lenSec;
    if (titleChanged) changes.title = title.trim().slice(0, 80) || slot.title;
    const err = onChange(changes, 'Updated');
    return setFormError(err);
  }
  function clearErr(fn) {
    return (e) => { setFormError(null); fn(e.target.value); };
  }

  return (
    <div className="sch-editor">
      <div className="tv-info-eyebrow">
        {isSeries ? 'Series block' : slot.kind === 'episode' ? 'Title' : slot.kind === 'media' ? 'Upload' : slot.kind === 'ad_break' ? 'Ad break' : slot.kind === 'live' ? 'Live broadcast' : 'Slot'}
        {layer === 'default' ? ' · default schedule' : ''}
        {isTemp ? ' · not saved yet' : ''}
      </div>
      <h3>{slot.title}</h3>
      {slot.tier === 'premium' && <span className="sch-chip prem" style={{ alignSelf: 'flex-start' }}>Premium · airs with ads</span>}
      {slot.unavailable && <p className="sch-warn">This isn&rsquo;t available for channels anymore (unpublished, pulled, or opted out), so the time falls through to {layer === 'week' ? 'the default schedule' : 'the loop'}. Remove it or replace it.</p>}
      {locked && slot.kind === 'live' && !isPastDay && <p className="sch-muted">Only admins can change live broadcast slots.</p>}

      {isSeries && !locked && (
        <div className="sch-kinds" role="radiogroup" aria-label="Block type">
          {SERIES_KINDS.filter((k) => k !== 'series_continue' || layer === 'default').map((k) => {
            const disabled = busy || (k === 'series_rerun' && !sources.length);
            return (
              <button key={k} type="button" role="radio" aria-checked={slot.kind === k} className={`sch-kind k-${k}`} disabled={disabled && slot.kind !== k}
                onClick={() => {
                  if (slot.kind === k) return;
                  const changes = { kind: k, rerunOf: null };
                  if (k === 'series_rerun') changes.rerunOf = sources[sources.length - 1].id;
                  if (k === 'series_pinned' && eps.length && !slot.pinEpisodeId) { changes.pinEpisodeId = eps[0].id; changes.pinLabel = eps[0].label || eps[0].title; }
                  if (k !== 'series_pinned') { changes.pinEpisodeId = null; changes.pinLabel = null; }
                  setFormError(onChange(changes, `Now a ${KIND_INFO[k].name} block`));
                }}>
                <b>{KIND_ICON[k]} {KIND_INFO[k].name}</b>
                <small>{k === 'series_rerun' && !sources.length ? 'Needs a Continue or Pinned block of this series earlier the same day.' : KIND_INFO[k].help}</small>
              </button>
            );
          })}
        </div>
      )}

      <div className="sch-row">
        <label className="sch-field">
          <span>Starts</span>
          <input id="sch-start" type="time" step={300} value={start} onChange={clearErr(setStart)} disabled={locked} />
        </label>
        {lengthEditable && slot.kind !== 'ad_break' && (
          <label className="sch-field">
            <span>Length (minutes)</span>
            <input id="sch-len" type="number" min={Math.round(lim.min / 60)} max={Math.round(lim.max / 60)} step={1} value={minutes} onChange={clearErr(setMinutes)} />
          </label>
        )}
        {lengthEditable && slot.kind === 'ad_break' && (
          <label className="sch-field">
            <span>Length (seconds)</span>
            <input id="sch-len" type="number" min={30} max={1800} step={15} value={seconds} onChange={clearErr(setSeconds)} />
          </label>
        )}
        {!lengthEditable && (
          <div className="sch-field">
            <span>{hasFixedLength(slot) ? 'Runtime' : 'Length'}</span>
            <div className="sch-static">{dur(slot.runtimeSeconds || slot.durationSeconds)}</div>
          </div>
        )}
      </div>
      {prev && !locked && afterPrev !== slot.start && (
        <button type="button" className="sch-link" disabled={busy} onClick={() => setFormError(onChange({ start: afterPrev }, `Starts right after ${prev.title}`))}>
          Start right after {prev.title} ({clock(afterPrev)}{afterPrev !== prevEnd ? `, ${dur(afterPrev - prevEnd)} of ads between` : ''})
        </button>
      )}
      {prev && !locked && afterPrev !== prevEnd && prevEnd !== slot.start && (
        <button type="button" className="sch-link" disabled={busy} onClick={() => setFormError(onChange({ start: prevEnd }, `Starts flush after ${prev.title}`))}>
          Or flush after it, no ads ({clock(prevEnd)})
        </button>
      )}
      {edges.length > 0 && lengthEditable && (
        <div className="sch-field">
          <span>Fit exactly</span>
          <div className="sch-fits">
            {edges.slice(0, 6).map((len, i) => (
              <button key={len} type="button" aria-pressed={lenSec === len} onClick={() => { setFormError(null); setMinutes(String(len / 60)); }}>
                {i + 1} episode{i === 0 ? '' : 's'} · {dur(len)}
              </button>
            ))}
          </div>
        </div>
      )}
      {slot.kind === 'live' && (
        <label className="sch-field">
          <span>Title in the guide</span>
          <input id="sch-live-title" value={title} maxLength={80} onChange={clearErr(setTitle)} disabled={locked} />
        </label>
      )}
      <div className="sch-muted">
        {Number.isFinite(startSec) && Number.isFinite(lenSec) ? `Ends ${clock(startSec + lenSec)}` : 'Give it a length'}
        {hasFixedLength(slot) ? ` · ${dur(slot.durationSeconds)} slot for a ${dur(slot.runtimeSeconds || slot.durationSeconds)} title, the rest is ads` : ''}
      </div>
      {formError && <div className="sch-err" role="alert">{formError}</div>}
      {(timeChanged || lenChanged || titleChanged) && !locked && (
        <button type="button" className="sch-btn primary" disabled={busy} onClick={apply}>Apply</button>
      )}

      {slot.kind === 'series_pinned' && eps.length > 0 && !locked && (
        <label className="sch-field">
          <span>Always start at</span>
          <select id="sch-pin" value={slot.pinEpisodeId || ''} disabled={busy} onChange={(e) => {
            const ep = eps.find((x) => x.id === e.target.value);
            setFormError(onChange({ pinEpisodeId: e.target.value, pinLabel: ep ? (ep.label || ep.title) : null }, `Starts at ${ep ? (ep.label || ep.title) : 'that episode'}`));
          }}>
            {eps.map((e) => <option key={e.id} value={e.id}>{e.label ? `${e.label} · ` : ''}{e.title}</option>)}
          </select>
        </label>
      )}
      {slot.kind === 'series_rerun' && !locked && (
        <label className="sch-field">
          <span>Rerun of</span>
          <select id="sch-rerun" value={slot.rerunOf || ''} disabled={busy} onChange={(e) => setFormError(onChange({ rerunOf: e.target.value }, 'Updated'))}>
            {sources.map((s) => <option key={s.id} value={s.id}>{clock(s.start)} · {KIND_INFO[s.kind].name}</option>)}
          </select>
        </label>
      )}

      {fit && (
        <p className="sch-muted">
          Fits {fit.count} episode{fit.count === 1 ? '' : 's'}
          {fit.leftover > 0 ? `, then ${dur(fit.leftover)} of ads and bumpers` : ' exactly'}.
          {fit.count === 0 ? ' The episode is longer than the block, so only ads would play. Make the block longer.' : ''}
        </p>
      )}
      {fit && fit.count > 0 && slot.kind !== 'series_continue' && (
        <div>
          <div className="tv-info-eyebrow" style={{ marginBottom: '0.35rem' }}>What plays</div>
          <div className="sch-runlog">
            {fit.items.map((it) => <div key={it.episode.id}><span>{clock(slot.start + it.at)}</span><span>{it.episode.label ? `${it.episode.label} · ` : ''}{it.episode.title}</span></div>)}
            {fit.leftover > 0 && <div><span>{clock(slot.start + fit.used)}</span><span>ads + bumpers</span></div>}
          </div>
        </div>
      )}

      {isSeries && upcoming.length > 0 && (
        <div>
          <div className="tv-info-eyebrow" style={{ marginBottom: '0.35rem' }}>How it runs</div>
          <div className="sch-runlog">
            {upcoming.map(([date, labels], i) => (
              <div key={date} className={i === 0 ? 'next' : ''}>
                <span>{DAY_SHORT[weekdayOfDate(date)]} {shortDate(date)}</span>
                <span>{labels.join(', ')}</span>
              </div>
            ))}
          </div>
          {slot.kind === 'series_continue' && (
            <p className="sch-muted" style={{ marginTop: '0.4rem' }}>
              Moves forward only on days it actually airs. After the last episode of a season it goes on to the next season, and after the last season, back to the first episode. Leftover time is ads and bumpers.
            </p>
          )}
        </div>
      )}
      {isSeries && !upcoming.length && !unchanged && <p className="sch-muted">Save the schedule to see its upcoming airings.</p>}
      {isSeries && !upcoming.length && unchanged && layer === 'week' && <p className="sch-muted">This week isn&rsquo;t published, so this block doesn&rsquo;t air yet.</p>}

      <div className="sch-editor-acts">
        {!isPastDay && <button type="button" className="sch-btn" disabled={busy} onClick={onDuplicate}>Duplicate</button>}
        {slot.kind === 'series_continue' && !isTemp && (
          <button type="button" className="sch-btn" disabled={busy || isDirty} title={isDirty ? 'Save the schedule first' : undefined} onClick={onResetBookmark}>Start over from episode 1</button>
        )}
        {!locked && <button type="button" className="sch-btn danger" disabled={busy} onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}

function CopyDay({ layer, day, tabs, busy, onCopy }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState([]);
  const label = tabs.find((t) => t.key === day);
  if (!open) return <button type="button" className="sch-btn" onClick={() => setOpen(true)} disabled={busy}>Copy {label ? label.label : 'day'} to…</button>;
  return (
    <div className="sch-copy">
      <span>Copy {label ? label.label : 'this day'} onto:</span>
      {tabs.filter((t) => t.key !== day && !t.past).map((t) => (
        <label key={t.key}>
          <input type="checkbox" checked={targets.includes(t.key)} onChange={() => setTargets((x) => (x.includes(t.key) ? x.filter((k) => k !== t.key) : [...x, t.key]))} />
          {t.label}
        </label>
      ))}
      <button type="button" className="sch-btn primary" disabled={busy || !targets.length}
        onClick={() => {
          if (!window.confirm(`Replace everything on ${targets.length} day${targets.length === 1 ? '' : 's'} with ${label ? label.label : 'this day'}'s lineup?`)) return;
          onCopy(targets);
          setOpen(false);
          setTargets([]);
        }}>Copy</button>
      <button type="button" className="sch-btn" onClick={() => { setOpen(false); setTargets([]); }}>Cancel</button>
      {layer === 'default' && <small>Each copy of a Continue block keeps its own place in the series. Copies land when you save.</small>}
    </div>
  );
}

/* ---------------- loop ---------------- */

function LoopView({ channelId, loop, library, busy, setBusy, setError, reload, flash }) {
  const [q, setQ] = useState('');
  async function act(method, body, msg) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/schedule/loop', method, { channelId, ...body });
      await reload();
      if (msg) flash(msg);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const total = (loop || []).reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
  const inLoop = new Set((loop || []).map((r) => r.episodeId));
  const options = library
    ? [...library.titles.map((t) => ({ id: t.id, name: t.title, durationSeconds: t.durationSeconds })),
       ...library.series.flatMap((s) => s.episodes.map((e) => ({ id: e.id, name: `${s.name} · ${e.label ? `${e.label} ` : ''}${e.title}`, durationSeconds: e.durationSeconds })))]
      .filter((o) => !inLoop.has(o.id) && (!q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase())))
    : [];

  return (
    <div className="sch-loop">
      <div className="sch-loop-list">
        <div className="sch-bar">
          <p className="sch-note">The loop plays back to back, round and round, and fills any time nothing else is scheduled. Full loop: <b>{dur(total)}</b>.</p>
          <button type="button" className="sch-btn" disabled={busy || !loop || !loop.length} onClick={() => window.confirm('Start the loop over from the top right now?') && act('PATCH', { action: 'restart' }, 'Loop restarted')}>Restart from the top</button>
        </div>
        {!loop && <div className="sch-muted">Loading…</div>}
        {loop && loop.length === 0 && <div className="ca-empty">The loop is empty. Until you add something, gaps in the schedule show as off the air.</div>}
        {loop && loop.map((r, i) => (
          <div key={r.id} className="sch-loop-row">
            <span className="sch-loop-pos">{i + 1}</span>
            <span className="sch-loop-title"><b>{r.title}</b><small>{dur(r.durationSeconds || 0)}</small></span>
            <span className="sch-loop-acts">
              <button type="button" className="sch-btn" disabled={busy || i === 0} onClick={() => act('PATCH', { id: r.id, action: 'moveUp' })} aria-label={`Move ${r.title} up`}>↑</button>
              <button type="button" className="sch-btn" disabled={busy || i === loop.length - 1} onClick={() => act('PATCH', { id: r.id, action: 'moveDown' })} aria-label={`Move ${r.title} down`}>↓</button>
              <button type="button" className="sch-btn danger" disabled={busy} onClick={() => act('PATCH', { id: r.id, action: 'remove' }, 'Removed from the loop')}>Remove</button>
            </span>
          </div>
        ))}
      </div>
      <div className="sch-lib">
        <div className="tv-info-eyebrow">Add to the loop</div>
        <input id="sch-loop-search" type="search" className="sch-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search titles to add" />
        <div className="sch-items">
          {!library && <div className="sch-muted">Loading…</div>}
          {library && options.length === 0 && <div className="sch-muted">Nothing else to add.</div>}
          {options.map((o) => (
            <button key={o.id} type="button" className="sch-ep" disabled={busy} onClick={() => act('POST', { episodeId: o.id }, 'Added to the loop')}>
              <span>{o.name}</span><small>+ {dur(o.durationSeconds)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
