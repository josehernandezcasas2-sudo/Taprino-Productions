// The fake Cloudflare Stream on :54324. lib/cloudflareUpload.js reaches it
// through CLOUDFLARE_API_BASE (http://127.0.0.1:54324/client/v4) and the
// delivery host through CLOUDFLARE_STREAM_ORIGIN (http://127.0.0.1:54324).
// In-memory videos; the seed's titles are preloaded ready and demanding
// signed links (seed/catalogue.mjs videos()).
//
// API under /client/v4/accounts/:account/stream:
//   POST ?direct_user=true (tus creation: Upload-Length, Upload-Metadata,
//        Upload-Creator → 201 + Location /tus/:uid), POST /direct_upload,
//   GET/POST/DELETE /:uid, POST /:uid/token, POST /copy, GET /,
//   GET/POST /:uid/downloads[/audio], live_inputs (create/get/delete)
// tus: POST/HEAD/PATCH/OPTIONS /tus/:uid; basic upload: POST /upload/:uid
// Delivery: /:uidOrToken/thumbnails/thumbnail.jpg (a JPEG frame),
//   /:uidOrToken/manifest/video.m3u8, /:uidOrToken/iframe,
//   /:uid/downloads/default.mp4 — a protected video answers 401 unless the
//   path carries one of this fake's tokens.
// Hooks: GET /__state, POST /__reset, POST /__ready?uid=[&duration=],
//   POST /__fail?uid=[&code=], POST /__autoready?seconds=N (0 = off),
//   POST /__video { uid?, name, creator, duration, ready, requireSignedURLs }
import crypto from 'node:crypto';
import http from 'node:http';
import { PORTS, HOST, FAKE_KEYS, urls } from '../lib/config.mjs';
import { readBody, sendJson, sendText, parseMultipart, logLine, listen, corsHeaders } from '../lib/http.mjs';
import { videos as seedVideos } from '../seed/catalogue.mjs';
import { jpegCard } from '../lib/images.mjs';

const SELF = urls().cloudflare;
const CODE = FAKE_KEYS.cloudflareCustomerCode;
const TOKEN_SECRET = crypto.randomBytes(32);
let autoReadySeconds = Number(process.env.RIG_CF_AUTOREADY_SECONDS || 0);

let videos = new Map();
let liveInputs = new Map();
const frames = new Map();

const newUid = () => crypto.randomBytes(16).toString('hex');
const nowIso = () => new Date().toISOString();

function video({ uid = newUid(), name = null, creator = null, duration = -1, ready = false, requireSignedURLs = false, uploadLength = null, maxDurationSeconds = null }) {
  return {
    uid,
    creator,
    meta: name ? { name } : {},
    created: nowIso(),
    modified: nowIso(),
    uploaded: ready ? nowIso() : null,
    uploadExpiry: null,
    size: uploadLength,
    maxSizeBytes: null,
    maxDurationSeconds,
    duration: ready ? duration : -1,
    _duration: duration,
    input: ready ? { width: 1920, height: 1080 } : { width: -1, height: -1 },
    readyToStream: ready,
    readyToStreamAt: ready ? nowIso() : null,
    status: ready ? { state: 'ready', pctComplete: '100.000000', errorReasonCode: '', errorReasonText: '' } : { state: 'pendingupload', pctComplete: '0', errorReasonCode: '', errorReasonText: '' },
    requireSignedURLs,
    allowedOrigins: [],
    scheduledDeletion: null,
    thumbnail: `https://customer-${CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`,
    thumbnailTimestampPct: 0,
    preview: `https://customer-${CODE}.cloudflarestream.com/${uid}/watch`,
    playback: { hls: `https://customer-${CODE}.cloudflarestream.com/${uid}/manifest/video.m3u8`, dash: `https://customer-${CODE}.cloudflarestream.com/${uid}/manifest/video.mpd` },
    watermark: null,
    clippedFrom: null,
    publicDetails: null,
    _offset: 0,
    _downloads: {}
  };
}

function seed() {
  videos = new Map();
  liveInputs = new Map();
  for (const v of seedVideos()) videos.set(v.uid, video({ uid: v.uid, name: v.name, creator: v.creator, duration: v.duration, ready: true, requireSignedURLs: true, uploadLength: 50 * 1024 * 1024 }));
}
seed();

const view = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')));
const ok = (res, result, status = 200) => sendJson(res, status, { success: true, errors: [], messages: [], result });
const fail = (res, status, code, message) => sendJson(res, status, { success: false, errors: [{ code, message }], messages: [], result: null });

function markReady(v, duration) {
  v.status = { state: 'ready', pctComplete: '100.000000', errorReasonCode: '', errorReasonText: '' };
  v.readyToStream = true;
  v.readyToStreamAt = nowIso();
  v.duration = Number(duration) > 0 ? Number(duration) : v._duration > 0 ? v._duration : 60;
  v.input = { width: 1920, height: 1080 };
  v.modified = nowIso();
}

function uploadFinished(v) {
  v.uploaded = nowIso();
  v.status = { state: 'inprogress', pctComplete: '50.000000', errorReasonCode: '', errorReasonText: '' };
  v.modified = nowIso();
  if (autoReadySeconds > 0) setTimeout(() => videos.has(v.uid) && v.status.state === 'inprogress' && markReady(v), autoReadySeconds * 1000);
}

function parseTusMeta(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const [k, b64] = part.trim().split(' ');
    if (!k) continue;
    out[k.toLowerCase()] = b64 ? Buffer.from(b64, 'base64').toString('utf8') : true;
  }
  return out;
}

// Tokens: a JWT-shaped string whose payload names the video; signed with
// this process's own key (Cloudflare's are RS256 JWTs too).
function mintToken(uid, exp, downloadable = false) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', kid: 'rig' })}.${b64({ sub: uid, kid: 'rig', exp, downloadable })}`;
  return `${body}.${crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url')}`;
}
function readToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const want = crypto.createHmac('sha256', TOKEN_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (want !== parts[2]) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch (err) {
    return null;
  }
}

// Which video a delivery path names, and whether it may be served.
function resolveDelivery(idOrToken) {
  const claims = readToken(idOrToken);
  if (claims) {
    const v = videos.get(claims.sub);
    return v ? { v, allowed: true } : { v: null };
  }
  const v = videos.get(idOrToken);
  if (!v) return { v: null };
  return { v, allowed: !v.requireSignedURLs };
}

async function frameFor(v) {
  if (!frames.has(v.uid)) frames.set(v.uid, await jpegCard({ width: 1280, height: 720, title: (v.meta && v.meta.name) || v.uid.slice(0, 8), kicker: 'FAKE CLOUDFLARE FRAME' }));
  return frames.get(v.uid);
}

function manifest(idOrToken) {
  return ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"', `${SELF}/${idOrToken}/manifest/stream_720.m3u8`, ''].join('\n');
}

async function handleApi(req, res, seg, url, body) {
  // seg: ['accounts', acct, 'stream', ...]
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${FAKE_KEYS.cloudflareToken}`) return fail(res, 403, 10000, 'Authentication error');
  if (seg[0] !== 'accounts' || seg[2] !== 'stream') return fail(res, 404, 7003, 'Could not route to /client/v4/' + seg.join('/'));
  const rest = seg.slice(3);
  const json = () => {
    try { return JSON.parse(body.toString('utf8') || '{}'); } catch (e) { return {}; }
  };

  if (rest.length === 0 && req.method === 'POST' && url.searchParams.get('direct_user') === 'true') {
    const meta = parseTusMeta(req.headers['upload-metadata']);
    const length = Number(req.headers['upload-length']);
    if (!length) return fail(res, 400, 10005, 'Upload-Length is required');
    const v = video({ name: meta.name || null, creator: req.headers['upload-creator'] || null, requireSignedURLs: Boolean(meta.requiresignedurls), uploadLength: length, maxDurationSeconds: meta.maxdurationseconds ? Number(meta.maxdurationseconds) : null });
    if (meta.expiry) v.uploadExpiry = meta.expiry;
    videos.set(v.uid, v);
    res.writeHead(201, { Location: `${SELF}/tus/${v.uid}?tusv2=true`, 'stream-media-id': v.uid, 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, stream-media-id' });
    return res.end();
  }
  if (rest.length === 0 && req.method === 'GET') return ok(res, [...videos.values()].map(view));
  if (rest[0] === 'direct_upload' && req.method === 'POST') {
    const b = json();
    const v = video({ creator: b.creator || null, requireSignedURLs: Boolean(b.requireSignedURLs), maxDurationSeconds: b.maxDurationSeconds || null });
    videos.set(v.uid, v);
    return ok(res, { uploadURL: `${SELF}/upload/${v.uid}`, uid: v.uid, watermark: null });
  }
  if (rest[0] === 'copy' && req.method === 'POST') {
    const b = json();
    if (!b.url || !/^https?:\/\//.test(b.url)) return fail(res, 400, 10010, 'The URL is not a valid URL');
    const v = video({ name: (b.meta && b.meta.name) || null, creator: b.creator || null, requireSignedURLs: Boolean(b.requireSignedURLs) });
    v.status = { state: 'downloading', pctComplete: '0', errorReasonCode: '', errorReasonText: '' };
    v._sourceUrl = b.url;
    videos.set(v.uid, v);
    if (autoReadySeconds > 0) setTimeout(() => videos.has(v.uid) && markReady(v), autoReadySeconds * 1000);
    return ok(res, view(v));
  }
  if (rest[0] === 'live_inputs') {
    const id = rest[1];
    if (!id && req.method === 'POST') {
      const b = json();
      const uid = newUid();
      const li = { uid, meta: b.meta || {}, recording: b.recording || { mode: 'off' }, created: nowIso(), modified: nowIso(), rtmps: { url: 'rtmps://live.rig.example.com:443/live/', streamKey: crypto.randomBytes(16).toString('hex') }, status: { current: { state: 'disconnected' } } };
      liveInputs.set(uid, li);
      return ok(res, li);
    }
    const li = liveInputs.get(id);
    if (!li) return fail(res, 404, 10000, 'Live input not found');
    if (req.method === 'DELETE') {
      liveInputs.delete(id);
      return ok(res, null);
    }
    return ok(res, li);
  }

  const v = videos.get(rest[0]);
  if (!v) return fail(res, 404, 10005, 'Video not found');
  if (rest.length === 1 && req.method === 'GET') return ok(res, view(v));
  if (rest.length === 1 && req.method === 'POST') {
    const b = json();
    if (b.requireSignedURLs !== undefined) v.requireSignedURLs = Boolean(b.requireSignedURLs);
    if (b.meta) v.meta = { ...v.meta, ...b.meta };
    if (b.allowedOrigins) v.allowedOrigins = b.allowedOrigins;
    if (b.thumbnailTimestampPct !== undefined) v.thumbnailTimestampPct = b.thumbnailTimestampPct;
    v.modified = nowIso();
    return ok(res, view(v));
  }
  if (rest.length === 1 && req.method === 'DELETE') {
    videos.delete(v.uid);
    return ok(res, '');
  }
  if (rest[1] === 'token' && req.method === 'POST') {
    const b = json();
    const exp = Number(b.exp) || Math.floor(Date.now() / 1000) + 3600;
    return ok(res, { token: mintToken(v.uid, exp, Boolean(b.downloadable)) });
  }
  if (rest[1] === 'downloads') {
    const type = rest[2] === 'audio' ? 'audio' : 'default';
    if (req.method === 'POST') {
      v._downloads[type] = { status: 'ready', url: `${SELF}/${v.uid}/downloads/${type === 'audio' ? 'audio.m4a' : 'default.mp4'}`, percentComplete: 100 };
      return ok(res, { [type]: v._downloads[type] });
    }
    if (req.method === 'DELETE') {
      delete v._downloads[type];
      return ok(res, '');
    }
    return ok(res, v._downloads);
  }
  return fail(res, 404, 7003, 'No route for that URI');
}

async function handleTus(req, res, uid, body) {
  const v = videos.get(uid);
  const base = { 'Tus-Resumable': '1.0.0', 'Cache-Control': 'no-store', ...corsHeaders(req) };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...base, 'Tus-Version': '1.0.0', 'Tus-Extension': 'creation,creation-with-upload,expiration', 'Tus-Max-Size': String(30 * 1024 ** 3) });
    return res.end();
  }
  if (!v) {
    res.writeHead(404, base);
    return res.end('Not found');
  }
  if (req.method === 'POST') {
    if (req.headers['upload-length']) v.size = Number(req.headers['upload-length']);
    if (body.length) {
      v._offset += body.length;
      if (v.size && v._offset >= v.size) uploadFinished(v);
    }
    res.writeHead(201, { ...base, Location: `${SELF}/tus/${uid}?tusv2=true`, 'Upload-Offset': String(v._offset), 'stream-media-id': uid });
    return res.end();
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...base, 'Upload-Offset': String(v._offset), 'Upload-Length': String(v.size || 0) });
    return res.end();
  }
  if (req.method === 'PATCH') {
    const offset = Number(req.headers['upload-offset']);
    if (offset !== v._offset) {
      res.writeHead(409, base);
      return res.end('Upload-Offset mismatch');
    }
    v._offset += body.length;
    if (v.size && v._offset >= v.size && !v.uploaded) uploadFinished(v);
    res.writeHead(204, { ...base, 'Upload-Offset': String(v._offset) });
    return res.end();
  }
  res.writeHead(405, base);
  return res.end();
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => logLine('cloudflare', `${req.method} ${req.url.slice(0, 200)} ${res.statusCode} ${Date.now() - started}ms`));
  try {
    const url = new URL(req.url, 'http://local');
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? Buffer.alloc(0) : await readBody(req);

    if (url.pathname === '/__health') return sendJson(res, 200, { ok: true, videos: videos.size });
    if (url.pathname === '/__state') return sendJson(res, 200, { videos: [...videos.values()].map((v) => ({ ...view(v), uploadedBytes: v._offset })), liveInputs: [...liveInputs.values()], autoReadySeconds });
    if (url.pathname === '/__reset' && req.method === 'POST') {
      seed();
      return sendJson(res, 200, { ok: true, videos: videos.size });
    }
    if (url.pathname === '/__ready' || url.pathname === '/__fail') {
      const v = videos.get(url.searchParams.get('uid'));
      if (!v) return sendJson(res, 404, { error: 'no such video' });
      if (url.pathname === '/__ready') markReady(v, url.searchParams.get('duration'));
      else {
        v.status = { state: 'error', pctComplete: '0', errorReasonCode: url.searchParams.get('code') || 'ERR_MALFORMED_VIDEO', errorReasonText: url.searchParams.get('text') || 'The video was deemed to be corrupted or malformed.' };
        v.readyToStream = false;
      }
      return sendJson(res, 200, view(v));
    }
    if (url.pathname === '/__autoready') {
      autoReadySeconds = Number(url.searchParams.get('seconds') || 0);
      return sendJson(res, 200, { autoReadySeconds });
    }
    if (url.pathname === '/__video' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { b = {}; }
      const v = video({ uid: b.uid || newUid(), name: b.name || null, creator: b.creator || null, duration: b.duration || 60, ready: b.ready !== false, requireSignedURLs: b.requireSignedURLs !== false });
      videos.set(v.uid, v);
      return sendJson(res, 200, view(v));
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    if (seg[0] === 'client' && seg[1] === 'v4') return await handleApi(req, res, seg.slice(2), url, body);
    if (seg[0] === 'tus' && seg[1]) return await handleTus(req, res, seg[1], body);
    if (seg[0] === 'upload' && seg[1] && req.method === 'POST') {
      const v = videos.get(seg[1]);
      if (!v) return fail(res, 404, 10005, 'Video not found');
      const parts = parseMultipart(body, req.headers['content-type']);
      const file = parts.find((p) => p.filename !== null) || { data: body };
      v.size = file.data.length;
      v._offset = file.data.length;
      uploadFinished(v);
      res.writeHead(200, corsHeaders(req));
      return res.end();
    }

    // Delivery host.
    if (seg.length >= 2) {
      const { v, allowed } = resolveDelivery(seg[0]);
      if (!v) return sendText(res, 404, 'Video not found');
      if (!allowed) return sendText(res, 401, 'This video requires a signed URL');
      if (seg[1] === 'thumbnails') {
        const jpg = await frameFor(v);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length, 'Access-Control-Allow-Origin': '*' });
        return res.end(jpg);
      }
      if (seg[1] === 'manifest') {
        if (!v.readyToStream) return sendText(res, 404, 'Video not ready');
        return sendText(res, 200, manifest(seg[0]), 'application/vnd.apple.mpegurl', { 'Access-Control-Allow-Origin': '*' });
      }
      if (seg[1] === 'iframe' || seg[1] === 'watch') return sendText(res, 200, `<!doctype html><title>Fake Stream player</title><body style="margin:0;background:#000;color:#fff;font-family:monospace;display:grid;place-items:center;height:100vh">Fake Cloudflare player · ${v.uid}</body>`, 'text/html; charset=utf-8');
      if (seg[1] === 'downloads') return sendText(res, 200, 'not a real video file', 'video/mp4');
    }
    return sendText(res, 404, 'The rig\'s fake Cloudflare has no such route');
  } catch (err) {
    console.error('fake cloudflare error:', err);
    if (!res.headersSent) sendJson(res, 500, { success: false, errors: [{ code: 500, message: err.message }] });
  }
});

await listen(server, PORTS.cloudflare, HOST, 'fake Cloudflare');
