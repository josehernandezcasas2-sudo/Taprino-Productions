import { clerkMiddleware } from '@clerk/nextjs/server';

// This deliberately does NOT protect any routes — free browsing (homepage,
// episode pages, genre/series/type pages) stays open to everyone, signed in
// or not, exactly like before. Clerk's middleware here just makes session
// info available to getServerSideProps via getAuth(req) on every request;
// the actual "is this premium content, and are they entitled to it" check
// still happens per-page, same as the rest of this app's design.
export default clerkMiddleware();

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
