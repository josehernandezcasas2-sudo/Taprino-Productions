// Small HTTP helpers shared by the stand-ins: body reading, JSON answers,
// multipart and form decoding, and a request log line.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';

export function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function jsonOrNull(buf) {
  if (!buf || buf.length === 0) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    return null;
  }
}

// multipart/form-data → [{ name, filename, contentType, data: Buffer }]
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return [];
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const parts = [];
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    let part = buf.subarray(start + boundary.length, next);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      const data = part.subarray(sep + 4);
      const disp = /content-disposition:[^\r\n]*/i.exec(head);
      const name = disp && /name="([^"]*)"/i.exec(disp[0]);
      const filename = disp && /filename="([^"]*)"/i.exec(disp[0]);
      const type = /content-type:\s*([^\r\n]+)/i.exec(head);
      parts.push({ name: name ? name[1] : '', filename: filename ? filename[1] : null, contentType: type ? type[1].trim() : null, data });
    }
    start = next;
  }
  return parts;
}

// Stripe-style form encoding (a[b][0][c]=v) → nested objects/arrays.
export function parseForm(text) {
  const out = {};
  const params = new URLSearchParams(text || '');
  for (const [rawKey, value] of params) {
    const keys = [];
    const re = /^([^[\]]+)|\[([^\]]*)\]/g;
    let mm;
    while ((mm = re.exec(rawKey))) keys.push(mm[1] !== undefined ? mm[1] : mm[2]);
    if (keys.length === 0) continue;
    let cur = out;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const last = i === keys.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(keys[i + 1]);
      if (Array.isArray(cur)) {
        const idx = k === '' ? cur.length : Number(k);
        if (last) cur[idx] = value;
        else cur = cur[idx] = cur[idx] !== undefined ? cur[idx] : nextIsIndex ? [] : {};
      } else if (last) {
        cur[k] = value;
      } else {
        cur = cur[k] = cur[k] !== undefined ? cur[k] : nextIsIndex ? [] : {};
      }
    }
  }
  return out;
}

export function logLine(name, line) {
  try {
    fs.appendFileSync(path.join(PATHS.logs, `${name}.requests.log`), `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    // the log is a convenience
  }
}

export function corsHeaders(req) {
  const origin = req.headers.origin;
  return origin
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable, Stream-Media-Id',
      'Access-Control-Max-Age': '600'
    }
    : {};
}

export function listen(server, port, host, name) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`${name} listening on http://${host}:${port}`);
      resolve();
    });
  });
}
