import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// This deliberately does NOT protect any routes — free browsing (homepage,
// episode pages, genre/series/type pages) stays open to everyone, signed in
// or not, exactly like before. Clerk's middleware here just makes session
// info available to getServerSideProps via getAuth(req) on every request;
// the actual "is this premium content, and are they entitled to it" check
// still happens per-page, same as the rest of this app's design.
//
// The one thing it adds (Creator Share referrals, lib/creatorShare.js): a
// visit carrying ?via=<handle> — which is what /@handle redirects to —
// remembers who sent the visitor in a 30-day cookie, last click wins.
// Checkout reads it to stamp the subscription with the referrer.
const VIA_COOKIE = 'tapa_via';
const VIA_MAX_AGE = 30 * 24 * 60 * 60;

export default clerkMiddleware((auth, req) => {
  const raw = req.nextUrl.searchParams.get('via');
  if (!raw) return undefined;
  const via = raw.trim().replace(/^@+/, '').slice(0, 64);
  if (!/^[A-Za-z0-9_.-]+$/.test(via)) return undefined;
  const res = NextResponse.next();
  res.cookies.set(VIA_COOKIE, via, {
    maxAge: VIA_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  });
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
