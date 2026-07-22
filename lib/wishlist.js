// Wishlisted episode IDs live as a comma-separated string in Stripe customer
// metadata — same "no separate database" pattern as the newsletter
// preference. This just parses that into an array wherever it's needed.
export function parseWishlist(customer) {
  if (!customer || !customer.metadata || !customer.metadata.wishlist) return [];
  return customer.metadata.wishlist.split(',').filter(Boolean);
}
