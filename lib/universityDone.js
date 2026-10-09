// "I did it" for Film University exercises. Remembered on this device
// (localStorage, keyed by exercise slug → ISO date) with no sign-in — the
// Workshop is free and anonymous by design. The mobile app keeps the same
// shape in SecureStore (mobile/src/lib/universityDone.js). Syncing it to
// an account can come later without changing the key.
const KEY = 'uni_done';

export function readDone() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

export function setDone(slug, done) {
  if (typeof window === 'undefined') return {};
  const next = { ...readDone() };
  if (done) next[slug] = new Date().toISOString().slice(0, 10);
  else delete next[slug];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    /* private mode — fine, it just won't stick */
  }
  return next;
}
