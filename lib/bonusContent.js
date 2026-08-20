// Bonus content is just episodes with content_type='bonus' and a parent
// pointer — no separate table or query needed, since the caller already
// has the full public episodes array from getPublicEpisodes(). This just
// filters it, same pattern as how genre rows filter episodes client-side.
export function getBonusContentFor(episodes, parentType, parentId) {
  return episodes.filter((e) => e.contentType === 'bonus' && e.bonusParentType === parentType && e.bonusParentId === parentId);
}
