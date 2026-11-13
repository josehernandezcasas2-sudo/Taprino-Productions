import { createHash } from 'node:crypto';
import { membershipLineKey } from './creatorShareRules.js'; // explicit .js so plain Node can run the checks

// SERVER-ONLY (node:crypto). Stable ids for creator_ledger lines: the same
// key always gives the same uuid (sha1 laid out as a version-5-style uuid,
// like lib/adShare.js adShareLineId), so a line written twice is refused by
// the primary key (23505) instead of crediting twice.

export function stableLineId(key) {
  const h = createHash('sha1').update(String(key)).digest('hex');
  const v = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// The lines of one membership payment (and reversals written with them)
// with their stable ids (lib/creatorShareRules.js membershipLineKey); a
// line without a key keeps the database's own id.
export function withMembershipLineIds(lines) {
  return (lines || []).map((l) => {
    const key = membershipLineKey(l);
    return key ? { ...l, id: stableLineId(key) } : l;
  });
}
