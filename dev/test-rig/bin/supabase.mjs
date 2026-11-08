// The Supabase stand-in on :54321, the address SUPABASE_URL points at.
//   /rest/v1/*     → PostgREST 12.2 on :54325 (prefix stripped), in front
//                    of the real Postgres cluster, like Supabase's gateway
//   /storage/v1/*  → the file-backed Storage stand-in (lib/storage.mjs)
//   /__health      → { ok } once PostgREST answers
//   /__storage     → buckets and object counts
// Listens on http :54321 and, with the rig's own CA, https :54331 (the
// address the app is given: next/image takes only https Supabase hosts).
// A request without an apikey is refused the way Supabase's gateway does.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { PORTS, HOST, urls } from '../lib/config.mjs';
import { loadKeys } from '../lib/keys.mjs';
import { handleStorage, storageState } from '../lib/storage.mjs';
import { sendJson, logLine, listen, corsHeaders } from '../lib/http.mjs';

const keys = loadKeys();
const PGRST = { host: HOST, port: PORTS.postgrest };

function proxyRest(req, res, rest) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const upstream = http.request({ ...PGRST, method: req.method, path: `/${rest}`, headers }, (up) => {
    const out = { ...up.headers };
    delete out.connection;
    res.writeHead(up.statusCode || 502, out);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) sendJson(res, 503, { message: `PostgREST is not answering: ${err.message}`, code: 'RIG_POSTGREST_DOWN' });
    else res.destroy();
  });
  req.pipe(upstream);
}

function pgrstReady() {
  return new Promise((resolve) => {
    const r = http.get({ host: HOST, port: PORTS.postgrestAdmin, path: '/ready', timeout: 1500 }, (up) => {
      up.resume();
      resolve(up.statusCode === 200);
    });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}

async function handler(req, res) {
  const started = Date.now();
  res.on('finish', () => logLine('supabase', `${req.method} ${req.url.slice(0, 300)} ${res.statusCode} ${Date.now() - started}ms`));
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    if (p === '/__health') return sendJson(res, 200, { ok: await pgrstReady(), postgrest: urls().postgrest });
    if (p === '/__storage') return sendJson(res, 200, storageState());
    if (p.startsWith('/storage/v1/')) {
      const rest = req.url.slice('/storage/v1/'.length).split('?')[0];
      return await handleStorage(req, res, rest, { jwtSecret: keys.jwtSecret, storageSecret: keys.storageSecret, publicBase: urls().supabase });
    }
    if (p.startsWith('/rest/v1')) {
      if (!req.headers.apikey && !req.headers.authorization) return sendJson(res, 401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
      return proxyRest(req, res, req.url.slice('/rest/v1'.length).replace(/^\//, ''));
    }
    return sendJson(res, 404, { message: `The rig's Supabase stand-in serves /rest/v1 and /storage/v1 only (asked for ${p}).` });
  } catch (err) {
    console.error('supabase stand-in error:', err);
    if (!res.headersSent) sendJson(res, err.status || 500, { message: err.message });
    else res.destroy();
  }
}

await listen(http.createServer(handler), PORTS.supabase, HOST, 'supabase stand-in (http)');
await listen(https.createServer({ key: fs.readFileSync(keys.tls.keyFile), cert: fs.readFileSync(keys.tls.certFile) }, handler), PORTS.supabaseTls, HOST, 'supabase stand-in (https)');
