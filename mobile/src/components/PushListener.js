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
  /^\/apply$/, /^\/creator$/, /^\/creator\/submit$/,
  /^\/account(\/(purchases|wishlist|my-work|artist-support|membership|profile|preferences|security))?$/, /^\/pitches\/[^/]+$/, /^\/episode\/[^/]+$/, /^\/series\/[^/]+$/,
  /^\/podcasts\/[^/]+$/, /^\/profile\/[^/]+$/, /^\/locations(\/[^/]+)?$/, /^\/locations\/requests(\/[^/]+)?$/, /^\/university(\/.*)?$/
];
const ALIASES = { '/creator/pitch/dashboard': '/creator/pitches', '/admin': '/admin', '/wishlist': '/account/wishlist', '/creator/my-work': '/account/my-work' };

// The show screens (the series revamp, slice 5) keep the part of the
// address that says where to land: a row (the website's #ep-<id> /
// #draft-<id> anchor, or ?ep= / ?draft=), the draft editor (?draft=1), the
// art tab (?tab=art). The older /creator/series?series=<id> (Series
// management, now the show pages) opens the show; the admin's show pages
// (/admin/shows/<id>) stay on the website like every admin page.
const enc = (x) => encodeURIComponent(String(x));
const SHOW_ID = '([^/?#]+)';
const SHOW_NEW = /^\/creator\/show\/new$/;
const SHOW_PAGE = new RegExp(`^/creator/show/${SHOW_ID}$`);
const SHOW_EPISODE = new RegExp(`^/creator/show/${SHOW_ID}/episode/${SHOW_ID}$`);
const SHOW_EDIT = new RegExp(`^/creator/show/${SHOW_ID}/edit$`);

function queryOf(href) {
  const at = href.indexOf('?');
  const q = at < 0 ? '' : href.slice(at + 1).split('#')[0];
  const out = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      // a broken pair is left out
    }
  }
  return out;
}

function showScreen(path, href) {
  if (SHOW_NEW.test(path)) return '/creator/show/new';
  const q = queryOf(href);
  const ep = SHOW_EPISODE.exec(path);
  if (ep) return `/creator/show/${ep[1]}/episode/${ep[2]}${q.draft === '1' ? '?draft=1' : ''}`;
  const edit = SHOW_EDIT.exec(path);
  if (edit) return `/creator/show/${edit[1]}/edit${q.tab === 'art' ? '?tab=art' : ''}`;
  const page = SHOW_PAGE.exec(path);
  if (page) {
    const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
    const anchor = /^(ep|draft)-(.+)$/.exec(hash);
    let row = null;
    if (anchor) {
      try { row = { key: anchor[1], id: decodeURIComponent(anchor[2]) }; } catch { row = null; }
    } else if (q.ep) row = { key: 'ep', id: q.ep };
    else if (q.draft) row = { key: 'draft', id: q.draft };
    return `/creator/show/${page[1]}${row ? `?${row.key}=${enc(row.id)}` : ''}`;
  }
  if (path === '/creator/series') return q.series ? `/creator/show/${enc(q.series)}` : '/creator';
  return null;
}

export function hrefToRoute(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return null;
  const path = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const show = showScreen(path, href);
  if (show) return { route: show };
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
