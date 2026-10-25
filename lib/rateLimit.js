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
      } else if (count > maxRequests) {
        // If setting the expiry ever failed, the counter would never reset
        // and lock this person out for good; NX only adds one that's missing.
        await redisFetch(['expire', key, String(windowSeconds), 'NX']).catch(() => {});
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

// Crawlers, link previews and scripts announce themselves in the
// User-Agent (or send none). Good enough to keep them out of view
// counts; not a security boundary.
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|httpclient|axios|node-fetch|go-http|java\/|headless|lighthouse|pingdom|uptime/i;
export function looksLikeBot(req) {
  const ua = (req && req.headers && req.headers['user-agent']) || '';
  return !ua || BOT_UA.test(ua);
}

export function rateLimitKeyForRequest(req, scope) {
  return `ratelimit:${scope}:${getClientIp(req)}`;
}

// A ceiling on reads of the public JSON (catalogue feeds, the token
// routes, profiles): generous for a person, far below a script dumping
// the catalogue (Jose, 2026-10-25). Keyed on the signed-in user when
// there is one, so a shared office IP never locks a member out, and on
// the IP otherwise. Writes the 429 itself and returns false; the route
// just returns. Routes behind a public s-maxage cache only see misses,
// which is where a sweep of ids lands anyway.
export async function limitPublicRead(req, res, scope, { max = 120, windowSeconds = 60, userId = null } = {}) {
  const key = `ratelimit:${scope}:${userId ? `u:${userId}` : getClientIp(req)}`;
  if (await checkRateLimit(key, max, windowSeconds)) return true;
  res.setHeader('Retry-After', String(windowSeconds));
  res.status(429).json({ error: 'Slow down a little.' });
  return false;
}

// True the first time `key` is seen within windowSeconds, false for every
// repeat — a dedupe rather than a counter (one billable ad impression per
// viewer per ad, for instance). Same Redis-or-memory fallback as above.
export async function firstInWindow(key, windowSeconds) {
  if (redisConfigured) {
    try {
      const result = await redisFetch(['set', key, '1', 'NX', 'EX', String(windowSeconds)]);
      return result.result === 'OK';
    } catch (err) {
      return true;
    }
  }
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (entry && now <= entry.resetAt) return false;
  memoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
  return true;
}
