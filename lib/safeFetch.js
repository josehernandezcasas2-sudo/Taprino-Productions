import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { validateRemoteVideoUrl } from './urlValidation';

// fetch() for links a creator typed (audio import, RSS preview/import),
// where this server does the fetching itself. validateRemoteVideoUrl
// only reads the hostname as written, so a name that resolves to a
// private address, or a public link that redirects to one, could still
// make the server fetch its own internal network. This resolves every
// hop's hostname and refuses private, loopback, link-local and metadata
// addresses, and follows redirects itself (at most 5), checking each.
//
// The connection goes to the very address that was checked (security
// round, 2026-10-26): fetch() would look the name up a second time, and a
// name that answers with a public address first and 127.0.0.1 the next
// time (DNS rebinding) would have slipped through. Only the standard web
// ports are allowed.
//
// Server-only (node:dns). Throws an Error with a message fit to show.

const MAX_REDIRECTS = 5;

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function privateAddress(ip) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

async function assertPublic(rawUrl) {
  const check = validateRemoteVideoUrl(rawUrl);
  if (!check.ok) throw new Error(check.error);
  const parsed = new URL(check.url);
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new Error('That link uses an unusual port — use a normal web link.');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  } catch (err) {
    throw new Error('That link’s address couldn’t be found.');
  }
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) {
    throw new Error('That link points somewhere private, not a public file.');
  }
  return { url: check.url, address: addresses[0].address, family: addresses[0].family || isIP(addresses[0].address) };
}

// One request to one checked address, answered as a standard Response so
// callers read it the way they read fetch().
function requestPinned({ url, address, family }, { method = 'GET', headers = {}, signal } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const pinnedLookup = (hostname, opts, cb) => {
    if (opts && opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  return new Promise((resolve, reject) => {
    const req = client.request(target, { method, headers, signal, lookup: pinnedLookup }, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v));
        else if (value != null) responseHeaders.set(key, String(value));
      }
      const empty = method === 'HEAD' || [204, 205, 304].includes(res.statusCode);
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage || '', headers: responseHeaders }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function safeFetch(rawUrl, options = {}) {
  let target = await assertPublic(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestPinned(target, options);
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return response;
    if (response.body) await response.body.cancel().catch(() => {});
    target = await assertPublic(new URL(location, target.url).toString());
  }
  throw new Error('That link redirects too many times.');
}

// The body as text, stopping as soon as it passes maxBytes rather than
// holding a huge answer in memory first.
export async function readTextCapped(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      const err = new Error('too large');
      err.tooLarge = true;
      throw err;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
