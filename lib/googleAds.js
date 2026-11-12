import { googleTagValid } from './googleAdTagRules';

// Google's Ad Manager tag for the website's video players (server only).
// GOOGLE_VIDEO_AD_TAG is the tag Jose pastes in Vercel once the studio has
// Ad Manager with Ad Exchange video; without it nothing changes (our own
// ads, and nothing when none is running). The players ask our house VAST
// first and only fall back to this tag when that yields no ad
// (lib/imaAdBreak.js), so a house ad always wins.
//
// It reaches a page only through props, and only for a viewer who gets ads
// (lib/adBreakRules.js adsOnFor: never an ad-free member, the team, a
// buyer, a preview or a title with ads off). An Ad Manager tag isn't a
// secret — every request a browser makes with it shows it — but it says
// nothing to anyone who gets no ads, and the admin only ever sees whether
// it's set.

let warned = false;

// The tag, or null when it's unset or isn't an Ad Manager tag (which is
// logged once per server instance and otherwise counts as unset: a typo
// must never send viewers' players somewhere else).
export function googleVideoAdTag() {
  const raw = String(process.env.GOOGLE_VIDEO_AD_TAG || '').trim();
  if (!raw) return null;
  if (googleTagValid(raw)) return raw;
  if (!warned) {
    warned = true;
    console.warn('GOOGLE_VIDEO_AD_TAG is set but is not an Ad Manager video tag (https://pubads.g.doubleclick.net/gampad/… or https://securepubads.g.doubleclick.net/gampad/…); Google will not fill empty breaks until it is.');
  }
  return null;
}

// Whether Google fills empty breaks (Admin → House ads says so).
export function googleFillOn() {
  return googleVideoAdTag() !== null;
}

// The tag for one viewer: only when they get ads (`adsOn`), else null.
export function googleAdTagFor(adsOn) {
  return adsOn ? googleVideoAdTag() : null;
}
