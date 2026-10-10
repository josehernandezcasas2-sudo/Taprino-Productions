import { useCallback, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/expo';
import { apiGet, apiPost } from './api';

// Which Film University lessons the viewer has marked done, on the phone —
// the same rules as the website's lib/universityProgress.js. Signed out:
// a list of lesson ids in SecureStore. Signed in: the account's list from
// /api/university/progress, and the first time this phone sees a
// signed-in viewer it folds its local ticks into the account (once).
// Screens pass in the ids the API gave them so the first render is right.
const LOCAL_KEY = 'uni_done_lessons';
const MERGED_KEY = 'uni_done_merged';

let cache = null;
const listeners = new Set();

async function readLocal() {
  if (cache) return cache;
  try {
    const raw = await SecureStore.getItemAsync(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch (err) {
    cache = [];
  }
  return cache;
}

async function writeLocal(ids) {
  cache = ids;
  try { await SecureStore.setItemAsync(LOCAL_KEY, JSON.stringify(ids)); } catch (err) { /* fine */ }
}

function broadcast(ids) {
  listeners.forEach((fn) => fn(ids));
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

export function useProgress(serverIds) {
  const { isSignedIn, getToken } = useAuth();
  const [doneIds, setDoneIds] = useState(isSignedIn && Array.isArray(serverIds) ? serverIds : []);
  const merging = useRef(false);

  useEffect(() => {
    listeners.add(setDoneIds);
    return () => { listeners.delete(setDoneIds); };
  }, []);

  useEffect(() => {
    if (Array.isArray(serverIds) && isSignedIn) setDoneIds(serverIds);
  }, [serverIds, isSignedIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSignedIn) {
        const local = await readLocal();
        if (!cancelled) setDoneIds(local);
        return;
      }
      const token = await withTimeout(getToken().catch(() => null), 4000);
      if (!token) return;
      const local = await readLocal();
      let merged = false;
      try { merged = (await SecureStore.getItemAsync(MERGED_KEY)) === '1'; } catch (err) { /* ignore */ }
      if (local.length && !merged && !merging.current) {
        merging.current = true;
        try {
          const res = await apiPost('/api/university/progress', { merge: local }, token);
          await SecureStore.setItemAsync(MERGED_KEY, '1').catch(() => {});
          if (!cancelled) broadcast(res.doneIds || []);
        } catch (err) { /* try again next time */ } finally { merging.current = false; }
      } else if (!Array.isArray(serverIds)) {
        try {
          const res = await apiGet('/api/university/progress', token);
          if (!cancelled) broadcast(res.doneIds || []);
        } catch (err) { /* keep what we have */ }
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  const toggle = useCallback(async (lessonId) => {
    const has = doneIds.includes(lessonId);
    const next = has ? doneIds.filter((id) => id !== lessonId) : [...doneIds, lessonId];
    broadcast(next);
    if (isSignedIn) {
      const token = await withTimeout(getToken().catch(() => null), 4000);
      if (token) apiPost('/api/university/progress', { lessonId, done: !has }, token).catch(() => {});
    } else {
      await writeLocal(next);
    }
  }, [doneIds, isSignedIn, getToken]);

  const done = new Set(doneIds);
  return { doneIds, isDone: (id) => done.has(id), toggle, isSignedIn };
}
