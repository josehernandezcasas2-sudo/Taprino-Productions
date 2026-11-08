// A Supabase Storage stand-in backed by files under RIG_DATA_DIR/storage:
// the endpoints @supabase/storage-js calls (buckets, upload/update,
// download, remove, list, move/copy, info, signed links, signed upload
// links) plus the public and signed object addresses a browser opens.
// State lives on disk only, so the seed and the server share it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { signHS256, verifyHS256 } from './jwt.mjs';
import { parseMultipart, readBody, sendJson } from './http.mjs';

const ROOT = () => path.join(PATHS.storage, 'objects');
const META = () => path.join(PATHS.storage, 'meta');
const BUCKETS = () => path.join(PATHS.storage, 'buckets.json');

export function readBuckets() {
  try {
    return JSON.parse(fs.readFileSync(BUCKETS(), 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeBuckets(b) {
  fs.mkdirSync(PATHS.storage, { recursive: true });
  fs.writeFileSync(BUCKETS(), JSON.stringify(b, null, 2));
}

export function ensureBucket(id, { public: isPublic = false, fileSizeLimit = null, allowedMimeTypes = null } = {}) {
  const b = readBuckets();
  if (!b[id]) {
    const now = new Date().toISOString();
    b[id] = { id, name: id, owner: '', public: isPublic, file_size_limit: fileSizeLimit, allowed_mime_types: allowedMimeTypes, created_at: now, updated_at: now, type: 'STANDARD' };
    writeBuckets(b);
  }
  return b[id];
}

// Object keys never climb out of the bucket's directory.
function safeKey(key) {
  const parts = String(key || '').split('/').filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/');
}

function objPath(bucket, key) {
  return path.join(ROOT(), safeKey(bucket), safeKey(key));
}
function metaPath(bucket, key) {
  return path.join(META(), safeKey(bucket), `${safeKey(key)}.json`);
}

export function putObject(bucket, key, data, { contentType = 'application/octet-stream', cacheControl = 'max-age=3600' } = {}) {
  const p = objPath(bucket, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  const mp = metaPath(bucket, key);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (err) {
    prev = null;
  }
  const now = new Date().toISOString();
  const meta = {
    id: prev ? prev.id : crypto.randomUUID(),
    name: safeKey(key),
    bucket_id: bucket,
    contentType,
    cacheControl,
    size: data.length,
    eTag: `"${crypto.createHash('md5').update(data).digest('hex')}"`,
    created_at: prev ? prev.created_at : now,
    updated_at: now
  };
  fs.writeFileSync(mp, JSON.stringify(meta));
  return meta;
}

export function getObject(bucket, key) {
  try {
    const data = fs.readFileSync(objPath(bucket, key));
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath(bucket, key), 'utf8'));
    } catch (err) {
      meta = { contentType: 'application/octet-stream', size: data.length };
    }
    return { data, meta };
  } catch (err) {
    return null;
  }
}

function removeObject(bucket, key) {
  const found = getObject(bucket, key);
  if (!found) return null;
  try { fs.unlinkSync(objPath(bucket, key)); } catch (err) { /* gone */ }
  try { fs.unlinkSync(metaPath(bucket, key)); } catch (err) { /* gone */ }
  return found.meta;
}

function listObjects(bucket, prefix) {
  const base = path.join(ROOT(), safeKey(bucket), safeKey(prefix));
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  return entries.map((e) => {
    if (e.isDirectory()) return { name: e.name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null };
    const key = [safeKey(prefix), e.name].filter(Boolean).join('/');
    const got = getObject(bucket, key);
    const m = got ? got.meta : {};
    return {
      name: e.name,
      id: m.id || null,
      updated_at: m.updated_at || null,
      created_at: m.created_at || null,
      last_accessed_at: m.updated_at || null,
      metadata: { eTag: m.eTag, size: m.size, mimetype: m.contentType, cacheControl: m.cacheControl, lastModified: m.updated_at, contentLength: m.size, httpStatusCode: 200 }
    };
  });
}

const err = (res, status, error, message) => sendJson(res, status, { statusCode: String(status), error, message });

function serveObject(req, res, bucket, key, { download } = {}) {
  const found = getObject(bucket, key);
  if (!found) return err(res, 400, 'not_found', 'Object not found');
  const headers = {
    'Content-Type': found.meta.contentType || 'application/octet-stream',
    'Content-Length': found.data.length,
    'Cache-Control': found.meta.cacheControl || 'no-cache',
    ETag: found.meta.eTag || '',
    'Access-Control-Allow-Origin': '*'
  };
  if (download !== undefined && download !== null) {
    const name = download || path.basename(key);
    headers['Content-Disposition'] = `attachment; filename="${name.replace(/"/g, '')}"`;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  return res.end(found.data);
}

function bodyToFile(buf, contentType, headerType) {
  if (/^multipart\/form-data/i.test(contentType || '')) {
    const parts = parseMultipart(buf, contentType);
    const file = parts.find((p) => p.filename !== null) || parts.find((p) => p.name === '') || null;
    const cc = parts.find((p) => p.name === 'cacheControl');
    return { data: file ? file.data : Buffer.alloc(0), contentType: (file && file.contentType) || 'application/octet-stream', cacheControl: cc ? `max-age=${cc.data.toString('utf8')}` : 'max-age=3600' };
  }
  return { data: buf, contentType: headerType || contentType || 'application/octet-stream', cacheControl: null };
}

function checkLimits(res, bucket, file) {
  const b = readBuckets()[bucket];
  if (!b) {
    err(res, 404, 'Bucket not found', 'Bucket not found');
    return false;
  }
  if (b.file_size_limit && file.data.length > Number(b.file_size_limit)) {
    err(res, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
    return false;
  }
  if (Array.isArray(b.allowed_mime_types) && b.allowed_mime_types.length) {
    const type = String(file.contentType || '').split(';')[0].trim();
    const ok = b.allowed_mime_types.some((pat) => pat === type || (pat.endsWith('/*') && type.startsWith(pat.slice(0, -1))));
    if (!ok) {
      err(res, 415, 'invalid_mime_type', `mime type ${type} is not supported`);
      return false;
    }
  }
  return true;
}

function sign(secret, claims, expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  return signHS256({ ...claims, iat: now, exp: now + Math.max(1, Number(expiresIn) || 60) }, secret);
}

// role from the Authorization bearer (PostgREST's secret), or null.
function roleOf(req, jwtSecret) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.headers.apikey || '');
  const claims = verifyHS256(token, jwtSecret);
  return claims ? claims.role : null;
}

// Handles /storage/v1/<rest>. `rest` has no leading slash.
export async function handleStorage(req, res, rest, { jwtSecret, storageSecret, publicBase }) {
  const url = new URL(req.url, 'http://local');
  const q = url.searchParams;
  const seg = rest.split('/').map((s) => decodeURIComponent(s));
  const method = req.method;

  // Addresses a browser opens: public objects and signed links.
  if (seg[0] === 'object' && seg[1] === 'public' && (method === 'GET' || method === 'HEAD')) {
    const bucket = seg[2];
    const b = readBuckets()[bucket];
    if (!b || !b.public) return err(res, 400, 'Bucket not found', 'Bucket not found');
    return serveObject(req, res, bucket, seg.slice(3).join('/'), { download: q.has('download') ? q.get('download') : undefined });
  }
  if ((seg[0] === 'render' && seg[1] === 'image' && seg[2] === 'public') && (method === 'GET' || method === 'HEAD')) {
    const bucket = seg[3];
    const b = readBuckets()[bucket];
    if (!b || !b.public) return err(res, 400, 'Bucket not found', 'Bucket not found');
    return serveObject(req, res, bucket, seg.slice(4).join('/'));
  }
  if (seg[0] === 'object' && seg[1] === 'sign' && (method === 'GET' || method === 'HEAD')) {
    const claims = verifyHS256(q.get('token'), storageSecret);
    const want = safeKey(seg.slice(2).join('/'));
    if (!claims || claims.url !== want) return err(res, 400, 'InvalidJWT', 'invalid signature');
    return serveObject(req, res, seg[2], seg.slice(3).join('/'), { download: q.has('download') ? q.get('download') : undefined });
  }
  if (seg[0] === 'object' && seg[1] === 'upload' && seg[2] === 'sign' && method === 'PUT') {
    const claims = verifyHS256(q.get('token'), storageSecret);
    const want = safeKey(seg.slice(3).join('/'));
    if (!claims || claims.url !== want || claims.kind !== 'upload') return err(res, 400, 'InvalidJWT', 'invalid signature');
    const bucket = seg[3];
    const key = seg.slice(4).join('/');
    const file = bodyToFile(await readBody(req), req.headers['content-type'], null);
    if (!checkLimits(res, bucket, file)) return undefined;
    if (!claims.upsert && getObject(bucket, key)) return err(res, 409, 'Duplicate', 'The resource already exists');
    putObject(bucket, key, file.data, { contentType: file.contentType, cacheControl: file.cacheControl || 'max-age=3600' });
    return sendJson(res, 200, { Key: `${bucket}/${key}` });
  }

  // Everything else needs a key; writes need the service role (a project's
  // buckets and objects have no policies here, as in this app's Supabase).
  const role = roleOf(req, jwtSecret);
  if (!role) return err(res, 400, 'Unauthorized', 'Invalid Compact JWS');
  if (role !== 'service_role') return err(res, 403, 'Unauthorized', 'new row violates row-level security policy');

  const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
  const json = () => {
    try { return JSON.parse(body.toString('utf8') || '{}'); } catch (e) { return {}; }
  };

  if (seg[0] === 'bucket') {
    const buckets = readBuckets();
    const id = seg[1];
    if (!id && method === 'GET') return sendJson(res, 200, Object.values(buckets));
    if (!id && method === 'POST') {
      const b = json();
      const bid = b.id || b.name;
      if (!bid) return err(res, 400, 'Invalid input', 'bucket name is required');
      if (buckets[bid]) return err(res, 409, 'Duplicate', 'The resource already exists');
      ensureBucket(bid, { public: Boolean(b.public), fileSizeLimit: b.file_size_limit ?? null, allowedMimeTypes: b.allowed_mime_types ?? null });
      return sendJson(res, 200, { name: bid });
    }
    if (id && seg[2] === 'empty' && method === 'POST') {
      if (!buckets[id]) return err(res, 404, 'Bucket not found', 'Bucket not found');
      fs.rmSync(path.join(ROOT(), safeKey(id)), { recursive: true, force: true });
      fs.rmSync(path.join(META(), safeKey(id)), { recursive: true, force: true });
      return sendJson(res, 200, { message: 'Successfully emptied' });
    }
    if (id && method === 'GET') return buckets[id] ? sendJson(res, 200, buckets[id]) : err(res, 404, 'Bucket not found', 'Bucket not found');
    if (id && method === 'PUT') {
      if (!buckets[id]) return err(res, 404, 'Bucket not found', 'Bucket not found');
      const b = json();
      buckets[id] = { ...buckets[id], public: b.public === undefined ? buckets[id].public : Boolean(b.public), file_size_limit: b.file_size_limit === undefined ? buckets[id].file_size_limit : b.file_size_limit, allowed_mime_types: b.allowed_mime_types === undefined ? buckets[id].allowed_mime_types : b.allowed_mime_types, updated_at: new Date().toISOString() };
      writeBuckets(buckets);
      return sendJson(res, 200, { message: 'Successfully updated' });
    }
    if (id && method === 'DELETE') {
      if (!buckets[id]) return err(res, 404, 'Bucket not found', 'Bucket not found');
      if (listObjects(id, '').length) return err(res, 409, 'InvalidRequest', 'The bucket you tried to delete is not empty');
      delete buckets[id];
      writeBuckets(buckets);
      return sendJson(res, 200, { message: 'Successfully deleted' });
    }
  }

  if (seg[0] === 'object') {
    if (seg[1] === 'sign' && method === 'POST') {
      const b = json();
      if (seg.length === 3) {
        // createSignedUrls: one bucket, many paths
        const bucket = seg[2];
        const out = (b.paths || []).map((p) => {
          if (!getObject(bucket, p)) return { error: 'Either the object does not exist or you do not have access to it', path: p, signedURL: null };
          const token = sign(storageSecret, { url: `${bucket}/${safeKey(p)}` }, b.expiresIn);
          return { error: null, path: p, signedURL: `/object/sign/${bucket}/${encodeURI(safeKey(p))}?token=${token}` };
        });
        return sendJson(res, 200, out);
      }
      const bucket = seg[2];
      const key = seg.slice(3).join('/');
      if (!getObject(bucket, key)) return err(res, 400, 'not_found', 'Object not found');
      const token = sign(storageSecret, { url: `${bucket}/${safeKey(key)}` }, b.expiresIn);
      return sendJson(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURI(safeKey(key))}?token=${token}` });
    }
    if (seg[1] === 'upload' && seg[2] === 'sign' && method === 'POST') {
      const bucket = seg[3];
      const key = seg.slice(4).join('/');
      if (!readBuckets()[bucket]) return err(res, 404, 'Bucket not found', 'Bucket not found');
      const token = sign(storageSecret, { url: `${bucket}/${safeKey(key)}`, kind: 'upload', upsert: req.headers['x-upsert'] === 'true' }, 2 * 3600);
      return sendJson(res, 200, { url: `/object/upload/sign/${bucket}/${encodeURI(safeKey(key))}?token=${token}`, token });
    }
    if (seg[1] === 'list' && method === 'POST') {
      const b = json();
      const all = listObjects(seg[2], b.prefix || '');
      const filtered = b.search ? all.filter((o) => o.name.includes(b.search)) : all;
      const off = Number(b.offset || 0);
      const lim = Number(b.limit || 100);
      return sendJson(res, 200, filtered.sort((x, y) => x.name.localeCompare(y.name)).slice(off, off + lim));
    }
    if ((seg[1] === 'move' || seg[1] === 'copy') && method === 'POST') {
      const b = json();
      const from = getObject(b.bucketId, b.sourceKey);
      if (!from) return err(res, 400, 'not_found', 'Object not found');
      const destBucket = b.destinationBucket || b.bucketId;
      putObject(destBucket, b.destinationKey, from.data, { contentType: from.meta.contentType, cacheControl: from.meta.cacheControl });
      if (seg[1] === 'move') removeObject(b.bucketId, b.sourceKey);
      return sendJson(res, 200, seg[1] === 'move' ? { message: 'Successfully moved' } : { Key: `${destBucket}/${safeKey(b.destinationKey)}` });
    }
    if (seg[1] === 'info') {
      const found = getObject(seg[2], seg.slice(3).join('/'));
      if (!found) return err(res, 400, 'not_found', 'Object not found');
      const m = found.meta;
      return sendJson(res, 200, { id: m.id, name: m.name, bucket_id: seg[2], size: m.size, content_type: m.contentType, cache_control: m.cacheControl, etag: m.eTag, last_modified: m.updated_at, created_at: m.created_at, metadata: {} });
    }
    const authed = seg[1] === 'authenticated';
    const bucket = authed ? seg[2] : seg[1];
    const key = (authed ? seg.slice(3) : seg.slice(2)).join('/');
    if ((method === 'GET' || method === 'HEAD') && bucket) return serveObject(req, res, bucket, key);
    if ((method === 'POST' || method === 'PUT') && bucket && key) {
      const file = bodyToFile(body, req.headers['content-type'], null);
      if (!checkLimits(res, bucket, file)) return undefined;
      const exists = Boolean(getObject(bucket, key));
      if (method === 'POST' && exists && req.headers['x-upsert'] !== 'true') return err(res, 409, 'Duplicate', 'The resource already exists');
      const meta = putObject(bucket, key, file.data, { contentType: file.contentType, cacheControl: file.cacheControl || req.headers['cache-control'] || 'max-age=3600' });
      return sendJson(res, 200, { Id: meta.id, Key: `${bucket}/${safeKey(key)}` });
    }
    if (method === 'DELETE' && bucket && !key) {
      const b = json();
      const out = [];
      for (const p of b.prefixes || []) {
        const m = removeObject(bucket, p);
        if (m) out.push({ name: m.name, bucket_id: bucket, id: m.id, owner: '', updated_at: m.updated_at, created_at: m.created_at, last_accessed_at: m.updated_at, metadata: { size: m.size, mimetype: m.contentType } });
      }
      return sendJson(res, 200, out);
    }
  }
  void publicBase;
  return err(res, 404, 'not_found', `The rig's storage stand-in has no ${method} /storage/v1/${rest}`);
}

export function storageState() {
  const buckets = readBuckets();
  const count = (dir) => {
    let n = 0;
    (function walk(p) {
      let entries = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) e.isDirectory() ? walk(path.join(p, e.name)) : n++;
    })(dir);
    return n;
  };
  return Object.fromEntries(Object.keys(buckets).map((id) => [id, { ...buckets[id], objects: count(path.join(ROOT(), id)) }]));
}

export function wipeStorage() {
  fs.rmSync(ROOT(), { recursive: true, force: true });
  fs.rmSync(META(), { recursive: true, force: true });
  fs.rmSync(BUCKETS(), { force: true });
}
