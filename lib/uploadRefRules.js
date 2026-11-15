// Pure, no imports: which stored addresses count as a person's own uploads
// to this site's storage (security fix of 2026-11-15). A place's photos, a
// performer's headshots and a host's ownership proof are taken from the
// browser as addresses the upload route answered with; until now they were
// checked by their first characters or by a substring, so an address with
// extra text after it (CSS that restyled the public pages), an image hosted
// anywhere, or a `..` path that made the server sign another bucket's file
// all passed. Each check here parses the address, requires exactly the
// configured Supabase origin and the path the upload route writes —
// `<prefix>-<account id>-<random>.<ext>` in the public artwork bucket, or
// `private:<prefix>-<account id>-<random>.<ext>` — with the account's own id.
//
// The random part is 18 hex characters today (lib/artworkUpload.js); older
// uploads may carry another mix of letters, digits and hyphens, which is
// accepted so a place saved before the change keeps its pictures.
const PUBLIC_ART_PATH = '/storage/v1/object/public/episode-art/';
const TAIL = '-[A-Za-z0-9-]{1,64}\\.(?:jpg|jpeg|png|webp|gif)';
// The whole stored string: no quote, bracket, space, backslash, percent,
// query or fragment — nothing CSS or a URL parser would read differently.
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/[A-Za-z0-9._/-]+$/;
// A Clerk account id (user_…): letters, digits and underscores.
const ACCOUNT_ID = /^[A-Za-z0-9_]{1,64}$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function supabaseBase(supabaseUrl) {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl) return null;
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { origin: u.origin, path: u.pathname.replace(/\/+$/, '') };
  } catch (err) {
    return null;
  }
}

// The file name inside the public artwork bucket, or null when `url` isn't
// exactly a plain address there.
export function publicArtFileName(url, supabaseUrl) {
  const base = supabaseBase(supabaseUrl);
  if (!base || typeof url !== 'string' || !PLAIN_URL.test(url)) return null;
  let u;
  try {
    u = new URL(url);
  } catch (err) {
    return null;
  }
  if (u.origin !== base.origin || u.search || u.hash || u.username || u.password) return null;
  const prefix = `${base.path}${PUBLIC_ART_PATH}`;
  if (!u.pathname.startsWith(prefix)) return null;
  const name = u.pathname.slice(prefix.length);
  if (!name || name.includes('/')) return null;
  return name;
}

function ownName(name, prefix, accountId) {
  if (typeof name !== 'string' || typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) return false;
  return new RegExp(`^${escapeRe(prefix)}-${escapeRe(accountId)}${TAIL}$`).test(name);
}

// A place's photo, uploaded by its host (lib/locations.js uploadListingImage:
// `location-photo-<host>-<random>.<ext>`).
export function isOwnLocationPhoto(url, hostId, supabaseUrl) {
  return ownName(publicArtFileName(url, supabaseUrl), 'location-photo', hostId);
}

// A photo already stored on a listing before these checks: kept on a later
// save while it is still a plain address in the artwork bucket under a
// `location-` name (never accepted from the browser as a new photo).
export function isSafeStoredLocationUpload(url, supabaseUrl) {
  const name = publicArtFileName(url, supabaseUrl);
  return Boolean(name) && /^location-[A-Za-z0-9_-]{1,160}\.(?:jpg|jpeg|png|webp|gif)$/.test(name);
}

// A host's ownership proof: `private:location-proof-<host>-<random>.<ext>`
// since 2026-10-25, or (uploaded before that) the same name in the public
// artwork bucket.
export function isLocationProofRef(value, hostId, supabaseUrl) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('private:')) return ownName(value.slice('private:'.length), 'location-proof', hostId);
  return ownName(publicArtFileName(value, supabaseUrl), 'location-proof', hostId);
}

// A performer's headshot (lib/crewCards.js uploadHeadshot:
// `headshot-<account>-<random>.<ext>`).
export function isOwnHeadshot(url, userId, supabaseUrl) {
  return ownName(publicArtFileName(url, supabaseUrl), 'headshot', userId);
}

// A path inside the private bucket (lib/privateStorage.js), or null when it
// could reach outside the folder it names: `..`, a backslash, a percent
// sign (an encoded one of those), a leading slash, an empty segment, or a
// control character.
export function safePrivatePath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (path.length > 500) return null;
  if (path.includes('..') || path.includes('\\') || path.includes('%') || path.startsWith('/') || path.includes('//')) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}
