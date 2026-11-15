import { getSupabase } from './supabase';
import { internalError } from './apiErrors';
import { AUDIO_TAKEN_LINE, audioAddressCheck, audioRowsConflict } from './titleSecurityRules';

// SERVER-ONLY. Whether a podcast audio address a request sent may be stored
// on a title (2026-11-15). For anyone but a full admin:
//   - it is a file in our own episode-audio storage, at the top of the
//     bucket, as /api/creator/import-audio-url stores it
//     (lib/titleSecurityRules.js audioAddressCheck);
//   - its name doesn't carry another account than `owners`' (the import
//     names every new file with the uploader: lib/audioUpload.js);
//   - no other uploader's episode already uses it (a row with no uploader
//     counts as someone else's), `selfId` being the title being saved.
// → { ok: true, path } (path null for no audio) or { ok: false, status,
// error }. A failed read throws (the caller answers it plainly), so an
// error never lets a file through.
export async function checkAudioAddress(stored, { owners = [], fullAdmin = false, selfId = null } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const verdict = audioAddressCheck(stored, { supabaseUrl, owners, fullAdmin });
  if (!verdict.ok || fullAdmin === true || !verdict.path) return verdict;
  // A superset first (a "_" in the name is a LIKE wildcard for one
  // character, and the path is only ASCII letters, digits, "_", "." and
  // "-"), then the exact stored path of each row (audioRowsConflict).
  const { data, error } = await getSupabase()
    .from('episodes')
    .select('id, submitted_by, audio_url')
    .ilike('audio_url', `%/episode-audio/${verdict.path}`)
    .limit(50);
  if (error) throw internalError(error, 'audio address');
  if (audioRowsConflict(data, verdict.path, { supabaseUrl, owners, selfId })) return { ok: false, status: 409, error: AUDIO_TAKEN_LINE };
  return verdict;
}
