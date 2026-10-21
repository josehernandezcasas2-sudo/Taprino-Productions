// The viewing terms, taken once per browser by anyone without an age on
// their account (signed out, or never set). One acceptance covers the live
// channels (any rated program, as /terms#live-tv says) and library titles
// under 17+; 17+ and unrated titles always need an account with an age.
//
// Remembered two ways: localStorage (what the live player always used) and
// a cookie, so server-rendered pages (the episode page, a podcast show)
// know before they render. Client-safe: no server imports.
export const VIEWING_TERMS_KEY = 'live-tv-terms-accepted';
export const VIEWING_TERMS_COOKIE = 'tapa_terms';

export function viewingTermsTaken() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(VIEWING_TERMS_KEY) === '1') return true;
  } catch (err) { /* private mode */ }
  try {
    return document.cookie.split(';').some((c) => c.trim() === `${VIEWING_TERMS_COOKIE}=1`);
  } catch (err) {
    return false;
  }
}

export function takeViewingTerms() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(VIEWING_TERMS_KEY, '1'); } catch (err) { /* private mode: the gate shows again next time */ }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${VIEWING_TERMS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
  } catch (err) { /* same */ }
}
