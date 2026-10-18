import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { validateRemoteVideoUrl } from './urlValidation';

// fetch() for links a creator typed (audio import, RSS preview/import),
// where this server does the fetching itself. validateRemoteVideoUrl
// only reads the hostname as written, so a name that resolves to a
// private address, or a public link that redirects to one, could still
// make the server fetch its own internal network. This resolves every
// hop's hostname and refuses private, loopback, link-local and metadata
// addresses, and follows redirects itself (at most 5), checking each.
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
  const host = new URL(check.url).hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch (err) {
    throw new Error('That link’s address couldn’t be found.');
  }
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) {
    throw new Error('That link points somewhere private, not a public file.');
  }
  return check.url;
}

export async function safeFetch(rawUrl, options = {}) {
  let url = await assertPublic(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return response;
    url = await assertPublic(new URL(location, url).toString());
  }
  throw new Error('That link redirects too many times.');
}
