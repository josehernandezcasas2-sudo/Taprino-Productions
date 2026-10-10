import { useCallback, useEffect, useRef, useState } from 'react';

// Which lessons the viewer has marked done, on the web.
//
// Signed out: a list of lesson ids in localStorage, so the ticks work
// without an account. Signed in: the account's list from
// /api/university/progress, and the first time a device with local ticks
// sees a signed-in viewer it folds them into the account (and keeps a
// note so it doesn't do it twice). Every page passes in what it got from
// the server (`serverIds`, null when signed out) so the first render is
// already right; the hook then owns the toggling.
const LOCAL_KEY = 'uni_done_lessons';
const MERGED_KEY = 'uni_done_merged';
const LEGACY_KEY = 'uni_done'; // the Workshop's slug → date map, no longer used

function readLocal() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch (err) {
    return [];
  }
}

function writeLocal(ids) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(ids));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch (err) {
    /* private mode — fine */
  }
}

async function post(body) {
  const res = await fetch('/api/university/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save your progress.');
  return data.doneIds || [];
}

export function useProgress({ isSignedIn, serverIds }) {
  const [doneIds, setDoneIds] = useState(() => (isSignedIn && Array.isArray(serverIds) ? serverIds : []));
  const merging = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      setDoneIds(readLocal());
      return;
    }
    const local = readLocal();
    let merged = false;
    try { merged = window.localStorage.getItem(MERGED_KEY) === '1'; } catch (err) { /* ignore */ }
    if (local.length > 0 && !merged && !merging.current) {
      merging.current = true;
      post({ merge: local })
        .then((ids) => {
          setDoneIds(ids);
          try { window.localStorage.setItem(MERGED_KEY, '1'); } catch (err) { /* ignore */ }
        })
        .catch(() => {})
        .finally(() => { merging.current = false; });
    }
  }, [isSignedIn]);

  const toggle = useCallback(
    (lessonId) => {
      setDoneIds((current) => {
        const has = current.includes(lessonId);
        const next = has ? current.filter((id) => id !== lessonId) : [...current, lessonId];
        if (isSignedIn) post({ lessonId, done: !has }).catch(() => {});
        else writeLocal(next);
        return next;
      });
    },
    [isSignedIn]
  );

  const done = new Set(doneIds);
  return { doneIds, isDone: (id) => done.has(id), toggle };
}
