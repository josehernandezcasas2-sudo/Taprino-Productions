// Podcast audio in private storage (Jose, 2026-11-12: "lets also get all
// podcasts into a good audio privated storage"). Pure and client-safe;
// tested by scripts/test-podcast-audio.mjs.
//
// Nothing is copied: the `episode-audio` bucket itself becomes private
// (new buckets are made private; Admin → AI security → "Lock podcast
// audio" flips the one that exists), rows keep the address they stored,
// and every play and download goes through one route,
// /api/podcasts/audio/<id>(.mp3|.m4a|…), which answers 302 to a link that
// lasts a few hours (pages/api/podcasts/audio/[id].js). Who may follow it:
//   - anyone, for an episode a show's public RSS feed lists (rssListsEpisode
//     below: the feed is public by design, podcast apps download from it);
//   - whoever holds a key the server minted after its own entitlement
//     check (the show page, the app's /api/podcast-show, the review queue);
//   - otherwise the playback gate (lib/playbackGate.js) decides, from the
//     session, exactly as it does for video.
// Audio stored somewhere else (an address an admin typed) is answered with
// a 302 to that address, after the same checks.
import { isTitleId } from './titleIds.js';

export const PODCAST_AUDIO_ROUTE = '/api/podcasts/audio';
export const AUDIO_BUCKET = 'episode-audio';

// What a stored file can be, by extension (the import names every file
// it stores with one of these).
export const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  weba: 'audio/webm'
};

// The link the route hands out (Supabase's own signed link) and the key
// a page or the app gets: a page can stay open for an afternoon; a podcast
// app keeps the feed's keyless address for good.
export const AUDIO_LINK_SECONDS = 6 * 60 * 60;
export const AUDIO_KEY_SECONDS = 12 * 60 * 60;

// The extension of a stored address (its path, not its query), or 'mp3'.
export function audioExtensionOf(stored) {
  const path = String(stored || '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(path);
  const ext = m ? m[1].toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(AUDIO_MIME, ext) ? ext : 'mp3';
}

export function audioMimeType(ext) {
  return Object.prototype.hasOwnProperty.call(AUDIO_MIME, ext) ? AUDIO_MIME[ext] : AUDIO_MIME.mp3;
}

// The route's address for an episode: "/api/podcasts/audio/<id>.<ext>",
// with the key when one was minted. Null for an id that isn't one.
export function podcastAudioPath(id, { ext = 'mp3', key = null } = {}) {
  if (!isTitleId(id)) return null;
  const e = Object.prototype.hasOwnProperty.call(AUDIO_MIME, ext) ? ext : 'mp3';
  return `${PODCAST_AUDIO_ROUTE}/${id}.${e}${key ? `?k=${encodeURIComponent(key)}` : ''}`;
}

// The route's [id] segment → { id, ext } (ext null when there was none),
// or null. Ids never contain a dot, so a trailing ".mp3" is unambiguous;
// any other extension is refused rather than guessed at.
export function parseAudioRouteId(raw) {
  const s = typeof raw === 'string' ? raw : '';
  const dot = s.lastIndexOf('.');
  let id = s;
  let ext = null;
  if (dot !== -1) {
    id = s.slice(0, dot);
    ext = s.slice(dot + 1).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(AUDIO_MIME, ext)) return null;
  }
  return isTitleId(id) ? { id, ext } : null;
}

// The object path inside our audio bucket, from the address a row stores
// (a Supabase public-style URL; the bucket being private doesn't change
// it). Null for anything else — audio hosted somewhere else, a different
// Supabase project, or a path that tries to climb out of the bucket.
export function audioStoragePath(stored, supabaseUrl) {
  const s = typeof stored === 'string' ? stored.trim() : '';
  const base = String(supabaseUrl || '').trim().replace(/\/+$/, '');
  if (!s || !base) return null;
  const prefix = `${base}/storage/v1/object/`;
  if (!s.startsWith(prefix)) return null;
  const rest = s.slice(prefix.length).split(/[?#]/)[0];
  const m = /^(?:public|sign|authenticated)\/episode-audio\/(.+)$/.exec(rest);
  if (!m) return null;
  let path;
  try {
    path = decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path)) return null;
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return path;
}

// An address that isn't in our storage but is still a link a player can
// open (an admin typed it, or another host's): http or https, as the
// pages handed it out before the route existed.
export function isExternalAudio(stored) {
  return typeof stored === 'string' && /^https?:\/\/[^\s]+$/i.test(stored.trim());
}

// Whether a show's public RSS feed lists this episode (lib/podcastRss.js
// uses the same rule, so the feed and the route can't drift): a free,
// approved podcast episode with audio, not held, not on its way out, not
// withdrawn, still available, under 17+ (`termsClear`: the feed carries
// what a listener with no age on file gets once they take the viewing
// terms, lib/ageGate.js), in a show that is public (`showPublic`).
export function rssListsEpisode(row, { showPublic = false, termsClear = false, now = Date.now() } = {}) {
  if (!row || typeof row !== 'object') return false;
  if (row.content_type !== 'podcast') return false;
  if (row.status !== 'approved' || row.tier !== 'free') return false;
  if (!row.audio_url) return false;
  if (row.moderation_hold || row.deletion_requested || row.withdrawn_at) return false;
  if (row.available_until && new Date(row.available_until).getTime() <= now) return false;
  return Boolean(showPublic && termsClear);
}

// The keys: who the server decided this was for when it minted one.
//   v  an ordinary listener (the show page, the app)
//   p  the owner's preview of a show or episode that isn't public
//   t  the team (the review queue, a team member's preview)
export const AUDIO_KEY_MODES = ['v', 'p', 't'];

// "<exp>.<mode>.<signature>" → { exp, mode, sig }, or null.
export function parseAudioKey(key) {
  const m = /^(\d{9,11})\.([vpt])\.([A-Za-z0-9_-]{20,100})$/.exec(typeof key === 'string' ? key : '');
  return m ? { exp: Number(m[1]), mode: m[2], sig: m[3] } : null;
}

// A key is the decision made when it was minted; the row can change in
// the hours after. Whether the row, as it is now, still plays for a key of
// this mode: a listener's key stops when the episode is held, removed,
// withdrawn or past its date; a preview key stops when the episode is
// declined, withdrawn or held; the team's when it is declined or withdrawn.
export function keyStillAllows(mode, row, now = Date.now()) {
  if (!row || typeof row !== 'object' || !row.audio_url) return false;
  if (row.withdrawn_at) return false;
  if (mode === 'v') {
    if (row.status !== 'approved' || row.moderation_hold || row.deletion_requested) return false;
    return !(row.available_until && new Date(row.available_until).getTime() <= now);
  }
  if (mode === 'p') return (row.status === 'approved' || row.status === 'pending') && !row.moderation_hold;
  if (mode === 't') return row.status === 'approved' || row.status === 'pending';
  return false;
}

// The same for the episode's show (`show` = its row's status,
// moderation_hold, deletion_requested, withdrawn_at; null when it is gone).
// `hasShow`: whether the episode belongs to one at all. A listener's key
// stops when the show is taken down, removed, withdrawn or made private; a
// preview key when the show is held; the team's never on the show's
// account.
export function showStillAllows(mode, show, { hasShow = Boolean(show) } = {}) {
  if (mode === 't') return true;
  if (!hasShow) return mode === 'v' || mode === 'p';
  if (!show || typeof show !== 'object') return false;
  if (mode === 'v') {
    const listed = show.status === 'approved' || show.status == null;
    return listed && !show.moderation_hold && !show.deletion_requested && !show.withdrawn_at;
  }
  if (mode === 'p') return !show.moderation_hold;
  return false;
}
