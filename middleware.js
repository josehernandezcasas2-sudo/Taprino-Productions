import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { privateBetaOn, isOpenPath, doorPath } from './lib/privateBetaRules';
import { suspensionFor, isSuspensionOpenPath, isSuspensionOpenApiWrite } from './lib/suspensionGate';
import { robotsTag } from './lib/robotsRules';

// Normally this deliberately does NOT protect any routes — free browsing
// (homepage, episode pages, genre/series/type pages) stays open to
// everyone, signed in or not. Clerk's middleware here just makes session
// info available to getServerSideProps via getAuth(req) on every request;
// the actual "is this premium content, and are they entitled to it" check
// still happens per-page, same as the rest of this app's design.
//
// Two additions:
//
// 1. Creator Share referrals (lib/creatorShare.js): a visit carrying
//    ?via=<handle> — which is what /@handle redirects to — remembers who
//    sent the visitor in a 30-day cookie, last click wins. Checkout reads
//    it to stamp the subscription with the referrer.
//
// 2. The private beta door (lib/privateBetaRules.js): while PRIVATE_BETA
//    is "on", a signed-out visitor gets /welcome instead of any page that
//    isn't on the open list, and an API route answers 401 with
//    { privateBeta: true } so the app can show its own door. Signed-in
//    people (only invited emails can create an account while Clerk's
//    sign-up mode is Restricted) see the whole site as usual. Every
//    response also carries X-Robots-Tag: noindex, belt and braces over
//    robots.txt. Off = this block never runs.
//
// 3. Account suspensions (lib/suspensionGate.js; migration 102, Jose
//    2026-10-24): a signed-in person with a whole-account suspension in
//    force is sent to /suspended from any page but the card itself and
//    the legal/contact pages, and every API write (anything but GET,
//    HEAD, OPTIONS) answers 403 { suspended } so the app can show its
//    gate. Reads pass: the shells need them to draw the card. One small
//    PostgREST read per person per minute per isolate; a database
//    hiccup fails open.
//
// 4. Every response carries X-Robots-Tag: noai, noimageai (lib/robotsRules.js;
//    Jose, 2026-10-25): a request to AI crawlers not to use the page or its
//    images, with noindex, nofollow added while the beta door is shut. It
//    lives here, not in next.config.js, so the two values never fight
//    over the same header.
const VIA_COOKIE = 'tapa_via';
const VIA_MAX_AGE = 30 * 24 * 60 * 60;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export default clerkMiddleware(async (auth, req) => {
  const { pathname, search, searchParams } = req.nextUrl;
  const beta = privateBetaOn();
  const isApi = pathname.startsWith('/api/');
  let userId;
  const who = async () => {
    if (userId === undefined) ({ userId } = await auth());
    return userId;
  };

  let res = null;
  if (beta && !isOpenPath(pathname)) {
    if (!(await who())) {
      if (isApi) {
        res = NextResponse.json({ error: 'Studio Tapa TV is in private beta. Sign in with an invited account.', privateBeta: true }, { status: 401 });
      } else {
        res = NextResponse.redirect(new URL(doorPath(pathname, search), req.url), 307);
      }
    }
  }

  const gated = isApi ? !READ_METHODS.has(req.method) && !isSuspensionOpenApiWrite(pathname) : !isSuspensionOpenPath(pathname);
  if (!res && gated && (await who())) {
    const suspended = await suspensionFor(userId);
    if (suspended && suspended.scope === 'all') {
      res = isApi
        ? NextResponse.json({ error: 'Your account is suspended.', suspended }, { status: 403 })
        : NextResponse.redirect(new URL('/suspended', req.url), 307);
    }
  }

  const raw = searchParams.get('via');
  const via = raw ? raw.trim().replace(/^@+/, '').slice(0, 64) : '';
  const setVia = via && /^[A-Za-z0-9_.-]+$/.test(via);

  if (!res) res = NextResponse.next();
  res.headers.set('X-Robots-Tag', robotsTag({ privateBeta: beta }));
  if (setVia) {
    res.cookies.set(VIA_COOKIE, via, {
      maxAge: VIA_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    });
  }
  return res;
});

export const config = {
  // Matches Clerk's own published recommended pattern exactly, rather than
  // a hand-rolled simplification — this matters because it explicitly
  // force-includes API routes as a separate rule, not just relying on the
  // general "skip static files" pattern to happen to also cover them. The
  // API routes are exactly where the sensitive checks live (wishlist,
  // checkout, portal session), so this isn't a place to improvise.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)'
  ]
};
