// Pure, server-only rules (node:net only): whether an address a link
// resolved to is one this server must never fetch for someone (lib/
// safeFetch.js) — private, loopback, link-local, shared, benchmark,
// multicast and the cloud metadata range on IPv4, and on IPv6 the same
// plus every form that carries an IPv4 address inside it, written any way:
// IPv4-mapped (::ffff:127.0.0.1, ::ffff:7f00:1), IPv4-compatible
// (::127.0.0.1, all of ::/96), NAT64 (64:ff9b::/96 and the local-use
// 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32). On a runtime
// with NAT64 any of those reaches the IPv4 address it carries, so they are
// refused outright rather than unpacked (2026-11-15).
import { isIP } from 'node:net';

export function privateV4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

// An IPv6 address as eight 16-bit numbers, or null when it can't be read.
// Handles `::` and a dotted IPv4 tail; drops a zone (`%eth0`).
export function ipv6Words(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s || !/^[0-9a-f:.]+$/.test(s)) return null;
  let tail = [];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[2].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    s = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const read = (part) => (part ? part.split(':') : []).map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    if (known !== 8) return null;
    return [...head, ...tail];
  }
  if (known > 7) return null;
  return [...head, ...new Array(8 - known).fill(0), ...rest, ...tail];
}

function v4FromWords(hi, lo) {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function privateV6(ip) {
  const w = ipv6Words(ip);
  if (!w) return true;
  const zero = (from, to) => w.slice(from, to).every((n) => n === 0);
  // ::/96 — the unspecified address, loopback (::1) and IPv4-compatible.
  if (zero(0, 6)) return true;
  // ::ffff:0:0/96 — IPv4-mapped, in either spelling.
  if (zero(0, 5) && w[5] === 0xffff) return privateV4(v4FromWords(w[6], w[7]));
  // ::ffff:0:0:0/96 (SIIT, "IPv4-translated").
  if (zero(0, 4) && w[4] === 0xffff && w[5] === 0) return true;
  // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 (local-use NAT64).
  if (w[0] === 0x64 && w[1] === 0xff9b) return true;
  // 2002::/16 (6to4) and 2001::/32 (Teredo).
  if (w[0] === 0x2002) return true;
  if (w[0] === 0x2001 && w[1] === 0) return true;
  // 2001:db8::/32 (documentation), 100::/64 (discard).
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true;
  if (w[0] === 0x100 && zero(1, 4)) return true;
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  if ((w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0) return true;
  if ((w[0] & 0xff00) === 0xff00) return true;
  return false;
}

export function privateAddress(ip) {
  const kind = isIP(String(ip || '').replace(/^\[|\]$/g, '').split('%')[0]);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) return privateV6(ip);
  // Not an address at all: never fetched.
  return true;
}
