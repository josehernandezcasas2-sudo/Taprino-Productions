import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// "I did it" for Film University exercises, remembered on this phone —
// same shape as the website's lib/universityDone.js (slug → ISO date),
// kept in SecureStore because that's the one small key/value store the
// app already uses (the live TV terms). No sign-in involved.
const KEY = 'uni_done';
let cache = null;
const listeners = new Set();

async function read() {
  if (cache) return cache;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    cache = {};
  }
  return cache;
}

async function write(next) {
  cache = next;
  listeners.forEach((fn) => fn(next));
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch (err) {
    /* storage unavailable — it just won't stick */
  }
}

export function useDoneMap() {
  const [done, setDone] = useState(cache || {});
  useEffect(() => {
    listeners.add(setDone);
    read().then(setDone);
    return () => { listeners.delete(setDone); };
  }, []);
  async function toggle(slug) {
    const current = await read();
    const next = { ...current };
    if (next[slug]) delete next[slug];
    else next[slug] = new Date().toISOString().slice(0, 10);
    await write(next);
  }
  return [done, toggle];
}
