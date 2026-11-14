import { useEffect } from 'react';
import { markStale, resumeDue, taskMark } from './resumeTaskRules';

// The website's half of lib/resumeTaskRules.js: the mark lives in
// sessionStorage, so it is this tab's alone and is gone when the tab
// closes. Every call is safe where storage is refused (a private window).
const KEY = 'tapa_resume';

function read() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clear() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing kept, nothing to clear */ }
}

// Before opening sign-in for something the person pressed.
export function rememberTask(task) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(taskMark(task, window.location.pathname, Date.now())));
  } catch { /* the task is not picked up; the page is still the right one */ }
}

// → the task to carry on with, once; null when there is none for `want`
// on this page. A stale mark is dropped on the way.
export function takeTask(want) {
  if (typeof window === 'undefined') return null;
  const mark = read();
  if (!mark) return null;
  const now = Date.now();
  if (markStale(mark, now)) { clear(); return null; }
  if (!resumeDue(mark, { want, path: window.location.pathname, now })) return null;
  clear();
  return mark.task;
}

// Runs `carryOn(task)` once when the person is signed in and a mark for
// `want` waits on this page: right after the sign-in box closes (the page
// gets its signed-in props) or after a full reload.
export function useResumeTask(want, isSignedIn, carryOn, ready = true) {
  useEffect(() => {
    if (!isSignedIn || !ready || !want) return;
    const task = takeTask(want);
    if (task) carryOn(task);
  }, [isSignedIn, ready, want]); // eslint-disable-line react-hooks/exhaustive-deps
}
