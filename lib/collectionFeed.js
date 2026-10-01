import { getAccountContext } from './accountContext';
import { getPublicEpisodes } from './publicEpisodes';
import { getAllSeries } from './series';
import { getLifecycleSettings, isNewRelease, isLeavingSoon } from './contentLifecycle';

// /collection/new-releases and /collection/leaving-soon are the only two
// valid slugs — anything else means "not found" for both callers.
export const COLLECTIONS = {
  'new-releases': { label: 'New Releases' },
  'leaving-soon': { label: 'Leaving Soon' }
};

// Shared by pages/collection/[slug].js and the mobile app's GET
// /api/collection — same slug validation, same isNewRelease/isLeavingSoon
// filtering against the shared lifecycle settings.
export async function getCollectionFeedData(slug, req) {
  const config = COLLECTIONS[slug];
  if (!config) return null;

  const [episodesWithBonus, allSeries, lifecycleSettings] = await Promise.all([
    getPublicEpisodes(),
    getAllSeries(),
    getLifecycleSettings()
  ]);
  const episodes = episodesWithBonus.filter((e) => e.contentType !== 'bonus');
  const account = await getAccountContext(req);

  const matches = slug === 'new-releases'
    ? episodes.filter((e) => isNewRelease(e.availableFrom, lifecycleSettings.newReleaseDays))
    : episodes.filter((e) => isLeavingSoon(e.availableUntil, lifecycleSettings.leavingSoonDays));

  const mainGenres = [...new Set(matches.map((e) => e.mainGenre).filter(Boolean))];

  return {
    slug,
    label: config.label,
    episodes: matches,
    allSeries,
    mainGenres,
    isSubscriber: account.isSubscriber,
    isSignedIn: account.isSignedIn,
    wishlist: account.wishlist,
    email: account.email,
    isAdmin: account.isAdmin,
    isCreator: account.isCreator
  };
}
