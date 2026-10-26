import { clerkClient } from '@clerk/nextjs/server';

// SERVER-ONLY. How old an account is, from Clerk (safety batch,
// 2026-10-26). Spam and pile-on reporting come from accounts made for
// the purpose, so a brand-new account gets smaller allowances: fewer new
// conversations, a smaller crew-call fan-out, and its reports don't count
// toward pulling a title automatically. Cached per instance for an hour;
// a Clerk hiccup reads as "not new" (the ordinary limits still apply).

export const NEW_ACCOUNT_DAYS = 3;
const TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // userId -> { createdAt, at }

async function load(ids) {
  const missing = ids.filter((id) => {
    const hit = cache.get(id);
    return !hit || Date.now() - hit.at > TTL_MS;
  });
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const client = await clerkClient();
      const { data } = await client.users.getUserList({ userId: chunk, limit: chunk.length });
      for (const u of data || []) cache.set(u.id, { createdAt: Number(u.createdAt) || null, at: Date.now() });
    } catch (err) {
      console.error('accountAge:', err.message);
    }
  }
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
}

// Age in days, or null when unknown.
export async function accountAgeDays(userId) {
  if (!userId || !/^user_/.test(userId)) return null;
  await load([userId]);
  const hit = cache.get(userId);
  return hit && hit.createdAt ? (Date.now() - hit.createdAt) / 86400000 : null;
}

export async function isNewAccount(userId, days = NEW_ACCOUNT_DAYS) {
  const age = await accountAgeDays(userId);
  return age != null && age < days;
}

// The ids among these that are younger than `days`.
export async function newAccountIds(userIds, days = NEW_ACCOUNT_DAYS) {
  const ids = [...new Set((userIds || []).filter((id) => /^user_/.test(id || '')))];
  if (!ids.length) return new Set();
  await load(ids);
  const out = new Set();
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && hit.createdAt && (Date.now() - hit.createdAt) / 86400000 < days) out.add(id);
  }
  return out;
}
