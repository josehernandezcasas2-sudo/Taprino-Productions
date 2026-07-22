// Tracks how many times each episode has been viewed — this is the primary
// signal for what wins the homepage hero slot, not a manually flipped
// `featured: true` flag. That flag still exists as a resilience fallback
// (a momentary Redis outage, or the two env vars below being briefly
// unset, shouldn't take down the whole homepage) — but the real, expected
// setup has this configured.
//
// Uses Upstash Redis (free tier: 500K commands/month, no card required —
// https://upstash.com). Set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN in .env.local — see the README for the full
// setup steps. Without those two env vars, every function here is a
// no-op and the app falls back to the manual `featured` flag — that's a
// safety net, not the intended steady state.

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export function isRedisConfigured() {
  return Boolean(BASE && TOKEN);
}

async function redisFetch(pathSegments) {
  const url = `${BASE}/${pathSegments.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Upstash Redis error: ${res.status}`);
  return res.json();
}

// Call this once per episode view (e.g. when someone opens the episode page).
export async function recordView(episodeId) {
  if (!isRedisConfigured() || !episodeId) return;
  try {
    await redisFetch(['zincrby', 'episode_views', '1', episodeId]);
  } catch (err) {
    // Non-fatal — a missed view count is not worth breaking the page over.
    console.error('recordView error:', err.message);
  }
}

// Returns { episodeId: viewCount } for every episode with at least one view.
export async function getViewCounts() {
  if (!isRedisConfigured()) return {};
  try {
    const data = await redisFetch(['zrange', 'episode_views', '0', '-1', 'WITHSCORES']);
    const flat = data.result || [];
    const counts = {};
    for (let i = 0; i < flat.length; i += 2) {
      counts[flat[i]] = Number(flat[i + 1]);
    }
    return counts;
  } catch (err) {
    console.error('getViewCounts error:', err.message);
    return {};
  }
}
