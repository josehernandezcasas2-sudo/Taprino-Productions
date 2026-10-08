import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { hasCapability } from './capabilities';

// The one getServerSideProps gate for admin pages. Replaces the copy of
// "getAccountContext → isAdmin ? props : redirect" that every
// pages/admin/*.js used to carry, and makes sub-admin access actually
// work: a page lists the capabilities that unlock it, and a sub-admin
// holding any of them gets in. No capabilities = full admins only.
//
//   export async function getServerSideProps(ctx) {
//     return adminPageProps(ctx, { caps: ['manage_house_ads'] });
//   }
//
// `extra(account)` can add page-specific props (awaited).
export async function adminPageProps({ req, res }, { caps = null, extra = null } = {}) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const account = await getAccountContext(req);
  const allowed = account.isAdmin || (account.canAccessAdmin && Array.isArray(caps) && caps.some((c) => hasCapability(account, c)));
  if (!allowed) {
    return { redirect: { destination: account.canAccessAdmin ? '/admin' : '/stream', permanent: false } };
  }
  const episodes = await getPublicEpisodes();
  const mainGenres = [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))];
  const extraProps = extra ? await extra(account) : {};
  return {
    props: {
      // Everything AdminShell + HeaderNav need, under one key so pages
      // don't have to thread six booleans through.
      account: {
        isSignedIn: account.isSignedIn,
        isSubscriber: account.isSubscriber,
        email: account.email || null,
        isAdmin: account.isAdmin,
        isSubAdmin: Boolean(account.isSubAdmin),
        canAccessAdmin: Boolean(account.canAccessAdmin),
        isCreator: account.isCreator,
        role: account.role || null,
        permissions: Array.isArray(account.permissions) ? account.permissions : []
      },
      mainGenres,
      ...extraProps
    }
  };
}
