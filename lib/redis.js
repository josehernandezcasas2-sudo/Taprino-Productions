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

export async function redisFetch(pathSegments) {
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

/* ===================================================================
   Daily view buckets
   ===================================================================
   The `episode_views` sorted set above is a running total only — it can
   say an episode has 1,204 views but not whether that's 1,200 from launch
   week and 4 since. A creator asking "is my work finding an audience?"
   needs the shape over time, which a single counter can't answer.

   So each view also increments a per-day hash, keyed episode_views:YYYY-MM-DD.
   Hashes (not one key per episode per day) keep this to a single write per
   view and a single read per day queried — comfortably inside Upstash's free
   500K commands/month at your traffic.

   Keys are set to expire after 400 days. Trend data has a natural shelf life
   and there's no reason to pay to store 2026's daily numbers in 2030.
   =================================================================== */

const DAY_TTL_SECONDS = 400 * 24 * 60 * 60;

export function dayKey(date = new Date()) {
  // UTC deliberately — a bucket that shifts with the viewer's timezone
  // double-counts around midnight and can't be summed reliably.
  return date.toISOString().slice(0, 10);
}

export async function recordDailyView(episodeId, creatorId) {
  if (!isRedisConfigured() || !episodeId) return;
  const key = `episode_views:${dayKey()}`;
  try {
    await redisFetch(['hincrby', key, episodeId, '1']);
    // EXPIRE is idempotent — resetting the same TTL on every write is fine
    // and saves a separate "does this key exist yet" round trip.
    await redisFetch(['expire', key, String(DAY_TTL_SECONDS)]);
    if (creatorId) {
      const ckey = `creator_views:${dayKey()}`;
      await redisFetch(['hincrby', ckey, creatorId, '1']);
      await redisFetch(['expire', ckey, String(DAY_TTL_SECONDS)]);
    }
  } catch (err) {
    console.error('recordDailyView error:', err.message);
  }
}

// Returns [{ date, counts: { episodeId: n } }] for the last `days` days,
// oldest first. Missing days come back as empty rather than being skipped,
// so a chart drawn from this has no phantom gaps.
export async function getDailyViews(days = 30) {
  if (!isRedisConfigured()) return [];
  const out = [];
  const today = new Date();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(dayKey(d));
  }
  try {
    const results = await Promise.all(
      keys.map(async (k) => {
        try {
          const data = await redisFetch(['hgetall', `episode_views:${k}`]);
          const flat = data.result || [];
          const counts = {};
          for (let i = 0; i < flat.length; i += 2) counts[flat[i]] = Number(flat[i + 1]);
          return { date: k, counts };
        } catch (err) {
          return { date: k, counts: {} };
        }
      })
    );
    return results;
  } catch (err) {
    console.error('getDailyViews error:', err.message);
    return out;
  }
}

/* ===================================================================
   Watch-time tracking (minutes watched), for the admin analytics page.
   ===================================================================
   Exact same daily-hash-bucket shape as the view-count tracking above —
   watch_seconds:YYYY-MM-DD instead of episode_views:YYYY-MM-DD. Tracked
   in whole SECONDS (hincrby only does integers) and converted to minutes
   only at display time, rather than trying to accumulate fractional
   minutes in Redis directly.

   This only captures SIGNED-IN viewing — it's recorded from
   /api/watch-progress, which already only runs for signed-in viewers
   (anonymous progress never leaves localStorage, so there's no
   server-side moment to hook this into for them). That's an inherited
   limitation of the existing progress system, not a new gap introduced
   here — "minutes watched" analytics undercounts anonymous traffic
   accordingly.
   =================================================================== */

export async function recordWatchSeconds(episodeId, seconds) {
  if (!isRedisConfigured() || !episodeId || !seconds || seconds <= 0) return;
  const key = `watch_seconds:${dayKey()}`;
  try {
    await redisFetch(['hincrby', key, episodeId, String(Math.round(seconds))]);
    await redisFetch(['expire', key, String(DAY_TTL_SECONDS)]);
  } catch (err) {
    console.error('recordWatchSeconds error:', err.message);
  }
}

// Same shape as getDailyViews — [{ date, counts: { episodeId: seconds } }],
// oldest first, missing days come back empty.
export async function getDailyWatchSeconds(days = 30) {
  if (!isRedisConfigured()) return [];
  const today = new Date();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(dayKey(d));
  }
  try {
    return await Promise.all(
      keys.map(async (k) => {
        try {
          const data = await redisFetch(['hgetall', `watch_seconds:${k}`]);
          const flat = data.result || [];
          const counts = {};
          for (let i = 0; i < flat.length; i += 2) counts[flat[i]] = Number(flat[i + 1]);
          return { date: k, counts };
        } catch (err) {
          return { date: k, counts: {} };
        }
      })
    );
  } catch (err) {
    console.error('getDailyWatchSeconds error:', err.message);
    return [];
  }
}
