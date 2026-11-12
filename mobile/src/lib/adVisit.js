import { AppState, Platform } from 'react-native';
import { openAdLink } from './adSlots';

// "Visit <brand> ↗" / "Learn more →": the advertiser's page in the in-app
// browser (adSlots.js openAdLink fires the click tracker and opens it),
// resolving once the viewer is back in the app, so whatever was paused for
// it can carry on — never while the page is still in front of them.
//
// iOS: the browser is a sheet over the app; openBrowserAsync resolves when
// it is dismissed. Android: it is a Custom Tab, another activity, and
// openBrowserAsync resolves the moment it is launched, so the app waits
// for itself to go to the background and come back. If it never leaves
// (no browser to open, the tab refused) it carries on after
// ANDROID_NO_LEAVE_MS.
const ANDROID_NO_LEAVE_MS = 3000;

export function visitAdvertiser(item, getToken) {
  if (Platform.OS !== 'android') return openAdLink(item, getToken).catch(() => {});
  return new Promise((resolve) => {
    let left = false;
    let finished = false;
    let fallback = null;
    let sub = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallback) clearTimeout(fallback);
      try { if (sub) sub.remove(); } catch { /* already gone */ }
      resolve();
    };
    // Listening before the tab opens: the app can go to the background
    // before openBrowserAsync answers.
    sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') left = true;
      else if (st === 'active' && left) finish();
    });
    openAdLink(item, getToken)
      .catch(() => {})
      .then(() => {
        if (!left) fallback = setTimeout(() => { if (!left) finish(); }, ANDROID_NO_LEAVE_MS);
      });
  });
}

export default visitAdvertiser;
