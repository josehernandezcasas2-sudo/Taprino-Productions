import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { refreshPushRegistration } from '../lib/push';
import { API_BASE_URL } from '../lib/api';

// Renders nothing. Keeps the push token fresh while signed in and turns
// a tapped notification into navigation: the server sends the website's
// href as data (lib/push.js); the app's routes mirror the website's for
// everything a notification points at, and anything else opens the
// website.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

const APP_ROUTES = [
  /^\/messages(\/[^/]+)?$/, /^\/crew\/calls(\/[^/]+)?$/, /^\/crew\/card$/, /^\/creator\/money$/, /^\/creator\/pitches$/,
  /^\/account(\/(purchases|wishlist|my-work|artist-support))?$/, /^\/pitches\/[^/]+$/, /^\/episode\/[^/]+$/, /^\/series\/[^/]+$/,
  /^\/podcasts\/[^/]+$/, /^\/profile\/[^/]+$/, /^\/locations(\/[^/]+)?$/, /^\/locations\/requests(\/[^/]+)?$/, /^\/university(\/.*)?$/
];
const ALIASES = { '/creator/pitch/dashboard': '/creator/pitches', '/admin': '/admin', '/wishlist': '/account/wishlist' };

export function hrefToRoute(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return null;
  const path = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const target = ALIASES[path] || path;
  if (target === '/') return { route: '/' };
  if (APP_ROUTES.some((re) => re.test(target))) return { route: target };
  return { url: `${API_BASE_URL}${href}` };
}

let openedOnLaunch = false;

export default function PushListener() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const open = (response) => {
      const data = response && response.notification && response.notification.request && response.notification.request.content ? response.notification.request.content.data : null;
      const where = hrefToRoute(data && data.href);
      if (!where) return;
      try {
        if (where.route) routerRef.current.push(where.route);
        else Linking.openURL(where.url);
      } catch { /* ignore */ }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    if (!openedOnLaunch) {
      openedOnLaunch = true;
      Notifications.getLastNotificationResponseAsync().then((r) => { if (r) open(r); }).catch(() => {});
    }
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) refreshPushRegistration(getToken);
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
