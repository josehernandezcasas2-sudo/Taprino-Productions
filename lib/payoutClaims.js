// The payout batch's claim on a creator's unpaid ledger lines
// (lib/creatorShareBatch.js runPayoutBatch), on its own so plain Node can
// test it with a stand-in client (scripts/test-creator-share.mjs).
//
// Each line is marked with the payout, CLAIM_CHUNK ids per update: the ids
// ride in the request's address, and one update naming every line of a
// creator with a few hundred of them grew past what the API takes, so the
// whole batch failed. Each part only takes lines nobody has claimed (payout
// still empty), so two runs at once can't pay one credit twice; it stops at
// the first part that fails or comes back short, and the caller gives back
// everything the payout took (update … set payout_id = null where
// payout_id = this payout).
//   → { count: lines this payout took, error }
export const CLAIM_CHUNK = 150;

export async function claimLines(supabase, payoutId, lineIds, { chunk = CLAIM_CHUNK } = {}) {
  const ids = lineIds || [];
  let count = 0;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const res = await supabase.from('creator_ledger').update({ payout_id: payoutId }).in('id', part).is('payout_id', null).select('id');
    if (res.error) return { count, error: res.error };
    const got = (res.data || []).length;
    count += got;
    if (got !== part.length) return { count, error: null };
  }
  return { count, error: null };
}
