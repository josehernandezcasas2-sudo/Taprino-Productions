// Watch progress lives as a compact JSON string in Stripe customer
// metadata — { episodeId: secondsWatched }, same "no separate database"
// pattern as the newsletter preference and wishlist.
export function parseWatchProgress(customer) {
  if (!customer || !customer.metadata || !customer.metadata.watchProgress) return {};
  try {
    return JSON.parse(customer.metadata.watchProgress);
  } catch (e) {
    return {};
  }
}
