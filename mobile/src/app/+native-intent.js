import { isCheckoutReturnPath } from '../lib/appReturn';

// Links the system hands the app, before the router opens a screen for
// them. The way back from a Stripe page (lib/appReturn.js) isn't a
// screen: the browser session that waits for it closes and the screen
// that opened it carries on (lib/inAppBrowser.js openCheckout), so the
// router leaves it alone — on Android the link reaches the router too.
export function redirectSystemPath({ path, initial }) {
  try {
    if (isCheckoutReturnPath(path)) return initial ? '/' : null;
  } catch { /* not a string: let the router decide */ }
  return path;
}
