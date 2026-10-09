import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';

// Shared getServerSideProps for the public /university pages: the header's
// account bits plus whatever the page itself loads. `load()` returns the
// page's own props, or null for a 404. Free, impersonal content, so a
// signed-out copy can sit in the shared cache for a couple of minutes;
// a signed-in visitor still needs a real header, so theirs never does.
// A missing table (migration 078 not run yet) renders as an empty
// University rather than a 500.
export async function universityPageProps({ req, res }, load) {
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    res.setHeader('Vary', 'Cookie');
  }

  const [account, episodes] = await Promise.all([getAccountContext(req), getPublicEpisodes()]);
  let pageProps;
  try {
    pageProps = await load();
  } catch (err) {
    console.error('university page error:', err.message);
    pageProps = { loadError: true };
  }
  if (pageProps === null) return { notFound: true };

  return {
    props: {
      mainGenres: [...new Set(episodes.map((e) => e.mainGenre).filter(Boolean))],
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      ...pageProps
    }
  };
}
