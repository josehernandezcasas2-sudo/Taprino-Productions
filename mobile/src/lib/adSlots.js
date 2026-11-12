import * as WebBrowser from 'expo-web-browser';
import { API_BASE_URL, absoluteUrl, freshToken } from './api';
import { AD_SLOT_TIMEOUT_MS, titleSlot, liveSlot, reelSlot } from './adBreakRules';

// The one place the app decides what plays in an ad slot and fetches it.
// A slot comes from mobile/src/lib/adBreakRules.js (titleSlot, liveSlot,
// reelSlot — the website's own choices): `{ source, path, wait }`. Today
// there are two sources, both the site's house ads:
//   pick  /api/house-ads/pick   one house ad (a title's plain break, a live
//                               break between programs or a scheduled one,
//                               a swipe feed's card)
//   fill  /api/ad-plan/fill     a ready plan's break: ads, bumpers, cards
// and both answer the same list of items, each with a `type`:
//   ad      { id, src, seconds, title, brand, clickUrl, clickTrackUrl, impressionUrl }
//   bumper  { id, src, seconds }
//   card    { variant, brand, seconds }      "Presented by" / "Supported by"
//   hold    { seconds }                      the hold card
// (a live break joined part way also carries `skip` on its first item).
//
// Another source later (Google's ads, once the app is a real build rather
// than Expo Go) is a new `source` here answering items of a new type, with
// that type's player added beside the others (ITEM_RUNNERS in
// mobile/src/lib/useAdBreak.js, ITEM_VIEWS in
// mobile/src/components/AdBreakLayer.js). Nothing else changes.
//
// An ad never holds up what the viewer came for: an answer slower than
// AD_SLOT_TIMEOUT_MS, an error or anything unusable is "nothing to play".

export { titleSlot, liveSlot, reelSlot };

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const API_ORIGIN = (() => {
  const m = String(API_BASE_URL).match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1].toLowerCase() : '';
})();
// A pixel or tracker on the site's own address gets the viewer's session
// (the impression refuses a creator's plays of their own title); nothing
// else ever does.
function onOwnHost(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/]+)/i);
  return Boolean(m && API_ORIGIN && m[1].toLowerCase() === API_ORIGIN);
}

async function getJson(path, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const request = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function adItem(raw) {
  const src = absoluteUrl(raw.src);
  if (!isHttp(src)) return null;
  return {
    type: 'ad',
    id: raw.id || null,
    src,
    seconds: Math.max(0, Number(raw.seconds) || 0),
    title: raw.title || '',
    brand: raw.brand || null,
    clickUrl: isHttp(raw.clickUrl) ? raw.clickUrl : null,
    clickTrackUrl: raw.clickTrackUrl ? absoluteUrl(raw.clickTrackUrl) : null,
    impressionUrl: raw.impressionUrl ? absoluteUrl(raw.impressionUrl) : null,
    ...(raw.skip ? { skip: raw.skip } : {})
  };
}

// One item as the players take it, or null for one they can't play.
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seconds = Math.max(0, Number(raw.seconds) || 0);
  const skip = Math.max(0, Number(raw.skip) || 0);
  if (raw.type === 'ad') return adItem(raw);
  if (raw.type === 'bumper') {
    const src = absoluteUrl(raw.src);
    return isHttp(src) ? { type: 'bumper', id: raw.id || null, src, seconds, ...(skip ? { skip } : {}) } : null;
  }
  if (raw.type === 'card') return { type: 'card', variant: raw.variant === 'supported_by' ? 'supported_by' : 'presented_by', brand: raw.brand || '', seconds, ...(skip ? { skip } : {}) };
  if (raw.type === 'hold') return { type: 'hold', seconds, ...(skip ? { skip } : {}) };
  return null;
}

// What plays in a slot → a list of items, [] for nothing.
export async function loadSlot(slot, { timeoutMs = AD_SLOT_TIMEOUT_MS } = {}) {
  if (!slot || !slot.path) return [];
  const data = await getJson(slot.path, timeoutMs);
  if (!data) return [];
  if (slot.source === 'pick') {
    const ad = data.ad;
    if (!ad) return [];
    const item = adItem({ id: ad.id, src: ad.videoUrl, seconds: ad.seconds, title: ad.title, brand: ad.brand, clickUrl: ad.clickUrl, clickTrackUrl: ad.clickTrackUrl || (ad.id ? `/api/house-ads/click?ad=${encodeURIComponent(ad.id)}` : null), impressionUrl: ad.impressionUrl });
    return item ? [item] : [];
  }
  if (slot.source === 'fill') {
    const fill = data.fill;
    if (!fill || !Array.isArray(fill.items)) return [];
    return fill.items.map(cleanItem).filter(Boolean);
  }
  return [];
}

// A tracking pixel (the impression as an ad starts, the click tracker on
// "Visit"): fire and forget, with the session on the site's own address.
export async function firePixel(url, getToken) {
  const u = absoluteUrl(url);
  if (!isHttp(u)) return;
  let token = null;
  if (onOwnHost(u) && typeof getToken === 'function') token = await freshToken(getToken, 3000);
  fetch(u, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).catch(() => {});
}

// "Visit <brand> ↗": the click tracker, then the advertiser's page in the
// in-app browser. Resolves once the browser is closed (iOS) or opened
// (Android, which can't tell).
export async function openAdLink(item, getToken) {
  if (!item || !isHttp(item.clickUrl)) return;
  if (item.clickTrackUrl) firePixel(item.clickTrackUrl, getToken);
  try {
    await WebBrowser.openBrowserAsync(item.clickUrl);
  } catch {
    // Nowhere to go: the ad carries on.
  }
}
