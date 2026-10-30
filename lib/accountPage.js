import { getAccountDashboardData } from './accountDashboard';
import { getPublicEpisodes } from './publicEpisodes';
import { cleanViaSlug } from './creatorShareRules';

// SERVER-ONLY (it reaches the Clerk server client through
// lib/accountDashboard.js — a page may import it for getServerSideProps
// and nothing else; the render-side helpers are in lib/accountRules.js).
// The props every page of the account hub shares (Jose, 2026-10-29,
// option B of the "Account page" canvas: /account is a hub of six tiles
// and each tile is its own page under /account/…). One Stripe-backed
// read and the genre list the header wants. A page that only makes sense
// signed in asks for `requireSignedIn` and is sent to the hub, which
// carries the sign-in card.
export async function accountPageProps(req, res, { requireSignedIn = false } = {}) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const { account, newsletterStatus, subscriptionDetails, promoAccessExpiresAt, plans } = await getAccountDashboardData(req);
  if (requireSignedIn && !account.isSignedIn) return { redirect: { destination: '/account', permanent: false } };

  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      tier: account.tier,
      plans,
      email: account.email,
      isAdmin: account.isAdmin,
      isSubAdmin: account.isSubAdmin,
      isCreator: account.isCreator,
      isComped: account.isComped,
      mainGenres,
      newsletterStatus,
      subscriptionDetails,
      promoAccessExpiresAt,
      userId: account.userId || null,
      // Two-step for the team (lib/adminTwoFactor.js): a team account
      // without it sees why, and what to do, on the Security page.
      teamTwoStep: (account.isAdmin || account.isSubAdmin || account.adminNeedsTwoFactor) ? { on: Boolean(account.twoFactorEnabled), required: Boolean(account.adminNeedsTwoFactor) } : null,
      twoFactorEnabled: Boolean(account.twoFactorEnabled),
      // The creator link they followed, if any (middleware.js), to prefill
      // "Did a creator send you?".
      viaHandle: cleanViaSlug(req.cookies && req.cookies.tapa_via) || null
    }
  };
}
