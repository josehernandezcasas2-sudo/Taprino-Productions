import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { privateBetaOn, isOpenPath, doorPath } from './lib/privateBetaRules';

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
const VIA_COOKIE = 'tapa_via';
const VIA_MAX_AGE = 30 * 24 * 60 * 60;

export default clerkMiddleware(async (auth, req) => {
  const { pathname, search, searchParams } = req.nextUrl;
  const beta = privateBetaOn();

  let res = null;
  if (beta && !isOpenPath(pathname)) {
    const { userId } = await auth();
    if (!userId) {
      if (pathname.startsWith('/api/')) {
        res = NextResponse.json({ error: 'Studio Tapa TV is in private beta. Sign in with an invited account.', privateBeta: true }, { status: 401 });
      } else {
        res = NextResponse.redirect(new URL(doorPath(pathname, search), req.url), 307);
      }
    }
  }

  const raw = searchParams.get('via');
  const via = raw ? raw.trim().replace(/^@+/, '').slice(0, 64) : '';
  const setVia = via && /^[A-Za-z0-9_.-]+$/.test(via);

  if (!res && !setVia && !beta) return undefined;
  if (!res) res = NextResponse.next();
  if (beta) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
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
