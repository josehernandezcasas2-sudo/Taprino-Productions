import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/stableAuth';
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
  /^\/apply$/, /^\/creator\/submit$/, /^\/creator\/pitch-new$/,
  /^\/account(\/(purchases|wishlist|my-work|artist-support|membership|profile|preferences|security))?$/, /^\/pitches\/[^/]+$/, /^\/episode\/[^/]+$/, /^\/series\/[^/]+$/,
  /^\/podcasts\/[^/]+$/, /^\/profile\/[^/]+$/, /^\/locations(\/[^/]+)?$/, /^\/locations\/requests(\/[^/]+)?$/, /^\/university(\/.*)?$/,
  // Productions (crew added, a call sheet, distribution) and Stream: the
  // app has these screens, and these addresses used to open the website.
  /^\/productions(\/[^/]+(\/(edit|distribution|day\/\d+))?)?$/, /^\/stream$/,
  // Downloads (2026-11-14): the website's /downloads is the app's page.
  /^\/downloads$/,
  // Your numbers, one of the Dashboard's tabs (2026-11-14; the Dashboard
  // itself is in SCREEN_KEEP below).
  /^\/creator\/numbers$/
];
// The website's /creator/analytics is the app's Your numbers, its
// /creator/pitch/new the app's Submit a project. /creator was Creator
// Studio's hub until the Dashboard took its place (2026-11-14): every
// address that meant the hub opens the Dashboard.
const ALIASES = {
  '/creator/pitch/dashboard': '/creator/pitches',
  '/creator/pitch/new': '/creator/pitch-new',
  '/admin': '/admin',
  '/wishlist': '/account/wishlist',
  '/creator/my-work': '/account/my-work',
  '/creator/analytics': '/creator/numbers',
  '/creator': '/creator/dashboard'
};
// Who gets paid (the series revamp, slice 3b; lib/payees.js) sends:
//   /creator#get-paid           → /creator/dashboard (payee_invite,
//   /creator/dashboard#get-paid   payee_invite_cancelled; the hash goes
//                                 before the match, and the Get paid card
//                                 is the first card under the numbers)
//   /creator/money              → /creator/money (payee_changed)
//   /creator/show/<id>#ep-<eid> → /creator/show/<id>?ep=<eid> (payee_invite_accepted
//                                 / _declined, payee_changed from the cut-over)
//   /creator/my-work            → /account/my-work (the same for a title of its own)

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
  // With no show named it meant the hub, which is the Dashboard now.
  if (path === '/creator/series') return q.series ? `/creator/show/${enc(q.series)}` : '/creator/dashboard';
  return null;
}

// The public series and episode screens (the series revamp, slice 4) keep
// the part of the address that says what to open: ?season=2 opens season
// 2, ?preview=1 the owner's preview, ?autoplay=1 the player. Anything else
// in the query is left behind, as on every other route.
const PUBLIC_TITLE = /^\/(episode|series)\/[^/]+$/;
const PUBLIC_KEEP = { season: /^\d{1,4}$/, preview: /^1$/, autoplay: /^1$/ };
// A podcast show's screen keeps only ?preview=1 (its owner's preview; the
// app's podcast screen has no seasons or autoplay).
const PODCAST_SHOW = /^\/podcasts\/[^/]+$/;
const PODCAST_KEEP = { preview: /^1$/ };
// Three creator screens keep what their address asks for (the Dashboard's
// rows link to them, 2026-11-14): the three-step submit opens the draft or
// the show, season and number it names; Your work opens on the filter.
// Until then "Continue" on a draft would have opened an empty form. The
// Dashboard keeps what the three steps hand it when a title is sent
// (?submitted=<title>&id=<title id>&show=<show id>: "… is in.").
const SCREEN_KEEP = {
  '/creator/submit': { draft: /^[A-Za-z0-9_-]{1,80}$/, type: /^[a-z]{1,20}$/, series: /^[A-Za-z0-9_-]{1,160}$/, season: /^\d{1,4}$/, number: /^\d{1,5}$/ },
  '/account/my-work': { status: /^(pending|approved|rejected)$/, attention: /^1$/ },
  '/creator/dashboard': { submitted: /^[\s\S]{1,300}$/, id: /^[A-Za-z0-9_-]{1,160}$/, show: /^[A-Za-z0-9_-]{1,160}$/ }
};

function keptQuery(href, keep = PUBLIC_KEEP) {
  const q = queryOf(href);
  const kept = Object.keys(keep).filter((k) => typeof q[k] === 'string' && keep[k].test(q[k]));
  return kept.length ? `?${kept.map((k) => `${k}=${enc(q[k])}`).join('&')}` : '';
}

export function hrefToRoute(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return null;
  const path = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const show = showScreen(path, href);
  if (show) return { route: show };
  const target = ALIASES[path] || path;
  if (target === '/') return { route: '/' };
  if (PUBLIC_TITLE.test(target)) return { route: `${target}${keptQuery(href)}` };
  if (PODCAST_SHOW.test(target)) return { route: `${target}${keptQuery(href, PODCAST_KEEP)}` };
  if (Object.prototype.hasOwnProperty.call(SCREEN_KEEP, target)) return { route: `${target}${keptQuery(href, SCREEN_KEEP[target])}` };
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
