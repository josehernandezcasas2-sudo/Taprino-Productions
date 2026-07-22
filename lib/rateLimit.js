// Rate limiting for endpoints that are cheap to abuse if left wide open —
// unauthenticated view tracking, and an endpoint that sends real emails to
// arbitrary addresses.
//
// Uses the same Upstash Redis connection as lib/redis.js when configured —
// this is the reliable path, since serverless functions don't share memory
// across instances, so an in-memory counter alone can be bypassed just by
// hitting a cold instance repeatedly.
//
// Without Redis configured, falls back to a simple in-memory counter. That
// fallback is honestly imperfect on serverless (resets on cold start, not
// shared across concurrent instances) — but it's free, requires no setup,
// and still meaningfully raises the bar above "completely open" for a
// single warm instance under moderate abuse. If you're not running Redis
// yet, this is a reason to consider turning it on beyond just the featured
// carousel.

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const redisConfigured = Boolean(BASE && TOKEN);

const memoryStore = new Map(); // key -> { count, resetAt }

async function redisFetch(pathSegments) {
  const url = `${BASE}/${pathSegments.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Upstash Redis error: ${res.status}`);
  return res.json();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

// Returns true if the request should be ALLOWED, false if rate limited.
// `key` should already be scoped to the specific endpoint (e.g.
// `track-view:${ip}`) so different endpoints don't share a budget.
export async function checkRateLimit(key, maxRequests, windowSeconds) {
  if (redisConfigured) {
    try {
      const incrResult = await redisFetch(['incr', key]);
      const count = incrResult.result;
      if (count === 1) {
        await redisFetch(['expire', key, String(windowSeconds)]);
      }
      return count <= maxRequests;
    } catch (err) {
      // If Redis itself is having a bad moment, fail open rather than
      // blocking real traffic over an infra hiccup.
      return true;
    }
  }

  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= maxRequests;
}

export function rateLimitKeyForRequest(req, scope) {
  return `ratelimit:${scope}:${getClientIp(req)}`;
}
