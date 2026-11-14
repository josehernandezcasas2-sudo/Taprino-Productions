#!/usr/bin/env node
// An opt-in stand-in for Upstash Redis, for view counts only (2026-11-14,
// with the creator's Dashboard). The rig normally runs with Upstash blank,
// so every view count reads zero and the numbers pages say "view counting
// isn't switched on". With this running and the app pointed at it, the
// views are real numbers a check can seed:
//
//   node dev/test-rig/bin/upstash.mjs &            # 127.0.0.1:54327
//   RIG_APP_ENV_UPSTASH_REDIS_REST_URL=http://127.0.0.1:54327 \
//   RIG_APP_ENV_UPSTASH_REDIS_REST_TOKEN=rig bash dev/test-rig/start.sh
//
// It keeps ONLY the view-counting keys (episode_views, episode_views:<day>,
// episode_watch_seconds, creator_views…): sorted sets and hashes, in
// memory. Everything else the app asks Redis for answers as an empty
// Redis would and stores nothing — a cache read misses, a rate-limit
// counter is always 1 — so turning it on changes nothing else about the
// rig (the catalogue is never cached, nobody is ever rate limited).
//
//   POST /__seed  { zsets: { key: { member: score } }, hashes: { key: { field: n } } }
//   POST /__reset          GET /__state
import http from 'node:http';

const PORT = Number(process.env.RIG_UPSTASH_PORT) || 54327;
const KEPT = /^(episode_views|episode_watch_seconds|creator_views)(:|$)/;
const zsets = new Map();
const hashes = new Map();

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function run(cmd, args) {
  const key = args[0] || '';
  const kept = KEPT.test(key);
  switch (cmd) {
    case 'zrange': {
      const set = zsets.get(key);
      if (!set) return [];
      const rows = [...set.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      const withScores = args.slice(3).some((a) => String(a).toUpperCase() === 'WITHSCORES');
      return rows.flatMap(([member, score]) => (withScores ? [member, String(score)] : [member]));
    }
    case 'zincrby': {
      if (!kept) return String(Number(args[1]) || 0);
      if (!zsets.has(key)) zsets.set(key, new Map());
      const set = zsets.get(key);
      const next = (set.get(args[2]) || 0) + (Number(args[1]) || 0);
      set.set(args[2], next);
      return String(next);
    }
    case 'hgetall': {
      const hash = hashes.get(key);
      return hash ? [...hash.entries()].flatMap(([f, v]) => [f, String(v)]) : [];
    }
    case 'hincrby': {
      if (!kept) return Number(args[2]) || 0;
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key);
      const next = (hash.get(args[1]) || 0) + (Number(args[2]) || 0);
      hash.set(args[1], next);
      return next;
    }
    case 'get': return null;
    case 'set': return 'OK';
    case 'incr': return 1;
    case 'expire': return 1;
    case 'del': return (zsets.delete(key) ? 1 : 0) + (hashes.delete(key) ? 1 : 0);
    default: return undefined;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === '__state') return send(res, 200, { zsets: Object.fromEntries([...zsets].map(([k, v]) => [k, Object.fromEntries(v)])), hashes: Object.fromEntries([...hashes].map(([k, v]) => [k, Object.fromEntries(v)])) });
  if (parts[0] === '__reset') { zsets.clear(); hashes.clear(); return send(res, 200, { ok: true }); }
  if (parts[0] === '__seed') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'JSON, please.' }); }
    for (const [key, members] of Object.entries(body.zsets || {})) zsets.set(key, new Map(Object.entries(members).map(([m, s]) => [m, Number(s) || 0])));
    for (const [key, fields] of Object.entries(body.hashes || {})) hashes.set(key, new Map(Object.entries(fields).map(([f, v]) => [f, Number(v) || 0])));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST') await readBody(req);
  const cmd = String(parts[0] || '').toLowerCase();
  const result = run(cmd, parts.slice(1));
  if (result === undefined) return send(res, 400, { error: `ERR the rig's Upstash stand-in has no '${cmd}'` });
  return send(res, 200, { result });
}).listen(PORT, '127.0.0.1', () => console.log(`[rig] Upstash stand-in (view counts only) on http://127.0.0.1:${PORT}`));
