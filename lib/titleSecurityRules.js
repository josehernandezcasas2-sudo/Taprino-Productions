// The rules behind the titles-and-shows security fixes (2026-11-15). Pure
// and client-safe: no server import, so a page may take a line from here
// and scripts/test-sec-titles.mjs runs every rule in plain Node.
//
//   - who reads and plays other people's unreleased titles ("the title
//     team"): a full admin, or a sub-admin holding review_submissions or
//     manage_episodes — never any team account (titleTeamWith);
//   - a withdrawn title or show stays withdrawn: its removal can't be
//     taken back, and a public reader never shows it (removalRefusal,
//     WITHDRAWN_LINE);
//   - a new file (video or trailer) on a title that isn't in review is a
//     reviewer's call (fileChangeView, FILE_REVIEW_LINE);
//   - a podcast's audio address is one of our own stored files, never an
//     address typed by a creator (audioAddressCheck, audioFileName);
//   - a screener plays only a title that could be shown (screenerTitleProblem);
//   - nobody but a full admin approves their own work (approvesOwnWork).
import { audioStoragePath } from './podcastAudioRules.js';

// --- the title team -----------------------------------------------------------

// The two capabilities that make a sub-admin part of the team that reads,
// previews and plays titles that aren't public: reviewing submissions and
// editing episodes. Anything else (artwork, deletions, flags, the
// schedule…) is a job on the title, not a key to every unreleased one.
export const TITLE_TEAM_CAPS = ['review_submissions', 'manage_episodes'];

// Whether `rc` (a getRoleContext / getAccountContext shape) holds any of
// `caps`. `can` is lib/capabilities.js hasCapability (passed in, so this
// file stays free of server imports). A full admin holds them all; a
// sub-admin only while the account can reach the admin area at all
// (canAccessAdmin: false when "Require two-step for the team" keeps it
// out), whatever its role and permission list still say.
export function holdsAnyCap(rc, caps, can) {
  if (!rc || typeof rc !== 'object') return false;
  if (rc.isAdmin === true) return true;
  if (rc.canAccessAdmin !== true) return false;
  if (typeof can !== 'function' || !Array.isArray(caps)) return false;
  return caps.some((cap) => can(rc, cap) === true);
}

export function titleTeamWith(rc, can) {
  return holdsAnyCap(rc, TITLE_TEAM_CAPS, can);
}

// --- withdrawn titles ------------------------------------------------------------

export const WITHDRAWN_LINE = 'It’s withdrawn and kept for its buyers. Ask us if it should come back.';
export const NO_REMOVAL_LINE = 'No removal is requested for this.';

// A title or show the team withdrew (kept for its buyers after a confirmed
// removal, Admin → "Remove this show", a legal takedown with buyers) keeps
// its removal: asking for it again or taking it back is refused, whoever
// asks and through whichever route. → null, or { status, code, error }.
export function removalRefusal(row) {
  if (row && typeof row === 'object' && row.withdrawn_at) return { status: 409, code: 'withdrawn', error: WITHDRAWN_LINE };
  return null;
}

// --- a new file on a title that isn't in review ------------------------------------

export const FILE_REVIEW_LINE = 'A reviewer approves a new file on a live title.';

// How a change of a title's file (its video or its trailer) is decided
// for this viewer: 'team' (applies at once, as the team's changes do) or
// 'owner' (exactly as the title's uploader's own change: in review or
// declined it applies, which brings a declined title back to review; on a
// live, pulled or withdrawn title it waits for a reviewer or is closed).
// A full admin and a reviewer decide as the team; another team member
// only while the title is in review (status 'pending') — a reviewer looks
// at the file before it goes out. Everyone else, as the owner. A team
// member who isn't the uploader and is decided as the owner is refused
// with FILE_REVIEW_LINE (the caller says so).
export function fileChangeView({ status = null, fullAdmin = false, reviewer = false, team = false } = {}) {
  if (fullAdmin === true || reviewer === true) return 'team';
  if (team !== true) return 'owner';
  return status === 'pending' ? 'team' : 'owner';
}

// --- podcast audio ---------------------------------------------------------------

export const AUDIO_NOT_OURS_LINE = 'Upload the audio here (or paste a link to the file and we’ll copy it in) — an outside address can’t be used.';
export const AUDIO_OTHERS_LINE = 'That audio file was uploaded by someone else.';
export const AUDIO_TAKEN_LINE = 'That audio file is already used by another title.';

const OWNER_ID = /^user_[A-Za-z0-9]{1,80}$/;
const SAFE_FILE = /^[A-Za-z0-9_.-]{1,200}$/;

// The name the import gives a file it stores: the uploader's account in
// it, so a path can be traced back to whoever brought it in (lib/
// audioUpload.js). `stamp` and `rand` are base-36 parts (the import passes
// the time and a random tail). An id that isn't a Clerk user id is left
// out (the name then reads like the older ones: no owner).
export function audioFileName(userId, ext, stamp, rand) {
  const e = /^[a-z0-9]{2,5}$/.test(String(ext || '')) ? String(ext) : 'mp3';
  const s = String(stamp || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || '0';
  const r = String(rand || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || '0';
  const owner = typeof userId === 'string' && OWNER_ID.test(userId) ? `${userId}-` : '';
  return `podcast-${owner}${s}-${r}.${e}`;
}

// The account a stored file's name carries (podcast-user_…-<stamp>-<rand>.<ext>),
// or null for an older name without one.
export function audioPathOwner(path) {
  const m = /^podcast-(user_[A-Za-z0-9]{1,80})-[a-z0-9]+-[a-z0-9]+\.[a-z0-9]{2,5}$/.exec(String(path || ''));
  return m ? m[1] : null;
}

// Whether an audio address a request sent may be stored. A full admin's is
// taken as sent (an admin may link audio hosted elsewhere). Anyone else's
// has to be a file in our own episode-audio storage, one file at the top
// of the bucket (what the import writes), and not named for another
// account than one of `owners` (the uploader, and on the admin's edit the
// title's own uploader). → { ok: true, path } (path null for no audio) or
// { ok: false, status, error }. Whether another title already uses the
// file is the server's read (audioRowsConflict on its answer).
export function audioAddressCheck(stored, { supabaseUrl, owners = [], fullAdmin = false } = {}) {
  const s = typeof stored === 'string' ? stored.trim() : '';
  if (!s) return { ok: true, path: null };
  if (fullAdmin === true) return { ok: true, path: audioStoragePath(s, supabaseUrl) };
  const path = audioStoragePath(s, supabaseUrl);
  if (!path || !SAFE_FILE.test(path) || !path.startsWith('podcast-')) return { ok: false, status: 400, error: AUDIO_NOT_OURS_LINE };
  const owner = audioPathOwner(path);
  const mine = (Array.isArray(owners) ? owners : []).filter(Boolean);
  if (owner && !mine.includes(owner)) return { ok: false, status: 403, error: AUDIO_OTHERS_LINE };
  return { ok: true, path };
}

// Of the episode rows a read found (each { id, submitted_by, audio_url }),
// one that uses the same stored file and isn't one of `owners`' — an
// uploader left blank counts as someone else's — and isn't the title being
// saved (`selfId`). → the row, or null.
export function audioRowsConflict(rows, path, { supabaseUrl, owners = [], selfId = null } = {}) {
  if (!path) return null;
  const mine = (Array.isArray(owners) ? owners : []).filter(Boolean);
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    if (selfId && r.id === selfId) continue;
    if (audioStoragePath(r.audio_url, supabaseUrl) !== path) continue;
    if (!r.submitted_by || !mine.includes(r.submitted_by)) return r;
  }
  return null;
}

// --- screeners -----------------------------------------------------------------

export const SCREENER_GONE_LINE = 'The video behind this screener isn’t available right now.';

function heldOrGone(row) {
  return Boolean(row && (row.moderation_hold || row.deletion_requested || row.withdrawn_at || row.status === 'rejected'));
}

// Why a title can't be played through a screener, or null when it can: the
// same rules as the owner's preview — approved or in review, not withdrawn,
// not on its way out, not pulled, a video to play — and its show (and, for
// an extra, the episode or show it hangs on) not pulled, taken down or
// declined, withdrawn or on its way out. `show` = its own show's row (or
// null), `parentEpisode` / `parentShow` = an extra's (or null);
// `unreadable` when a read of them failed (refused rather than guessed).
export function screenerTitleProblem(ep, { show = null, parentEpisode = null, parentShow = null, unreadable = false } = {}) {
  if (!ep || typeof ep !== 'object') return SCREENER_GONE_LINE;
  if (unreadable) return SCREENER_GONE_LINE;
  if (ep.status !== 'approved' && ep.status !== 'pending') return SCREENER_GONE_LINE;
  if (ep.withdrawn_at || ep.deletion_requested || ep.moderation_hold) return SCREENER_GONE_LINE;
  if (!ep.src) return SCREENER_GONE_LINE;
  if (heldOrGone(show) || heldOrGone(parentEpisode) || heldOrGone(parentShow)) return SCREENER_GONE_LINE;
  return null;
}

// --- approving your own work --------------------------------------------------------

export const OWN_WORK_LINE = 'Someone else on the team approves your own work.';

// Whether `reviewer` ({ userId, isAdmin }) would be approving their own
// work: they uploaded it, or they run the show (or own the upload) it
// belongs to. A full admin may (the studio's own titles go through them).
export function approvesOwnWork(reviewer, ownerIds = []) {
  if (!reviewer || typeof reviewer !== 'object' || reviewer.isAdmin === true) return false;
  const me = typeof reviewer.userId === 'string' && reviewer.userId ? reviewer.userId : null;
  if (!me) return false;
  return (Array.isArray(ownerIds) ? ownerIds : [ownerIds]).some((id) => id && id === me);
}
