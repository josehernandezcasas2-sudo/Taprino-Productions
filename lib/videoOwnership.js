import { getCloudflareVideoStatus } from './cloudflareUpload';
import { getSupabase } from './supabase';

// SERVER-ONLY. "Is this Cloudflare Stream video yours to attach?"
// (security round, 2026-10-26).
//
// Every video in the Cloudflare account is reachable by its uid, and a
// uid is not a secret: it sits in the claims of every signed playback
// token a viewer receives. So a route that takes a uid from the browser
// (an episode's video or trailer, a series trailer, a channel upload, a
// self-tape) must check whose upload it is, or anyone could attach a
// premium film to their own row and play it through that row's
// permissions. Uploads made through this site are tagged with the
// uploader's account (creator/get-upload-url, creator/import-video-url,
// crew/self-tape-upload-url pass `creator`); that tag is the answer.
//
// A video uploaded before tagging existed has no tag. It is accepted only
// when nothing belonging to someone else already uses it, which is the
// rule submit-episode has applied since the tag was introduced. Admins
// may attach anything.
export const VIDEO_UID_PATTERN = /^[a-zA-Z0-9]{16,64}$/;

function missingRelation(error) {
  return Boolean(error && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || /schema cache|does not exist/i.test(error.message || '')));
}

// Does anything that isn't this person's use the uid already? (With no
// userId: does anything use it at all.) Each lookup tolerates a table or
// column that isn't there yet (a database behind on migrations), and a
// lookup that fails for another reason counts as "in use", so an error
// never lets a video through or gets one deleted.
async function usedByOthers(uid, userId) {
  const supabase = getSupabase();
  const like = `%${uid}%`;
  const notMine = (query, column) => (userId ? query.neq(column, userId) : query);
  const checks = [
    () => notMine(supabase.from('episodes').select('id').or(`src.ilike.${like},trailer_src.ilike.${like},audio_description_src.ilike.${like}`), 'submitted_by').limit(1),
    () => notMine(supabase.from('series').select('id').or(`trailer_src.ilike.${like},pending_trailer_src.ilike.${like}`), 'creator_id').limit(1),
    () => notMine(supabase.from('channel_media').select('id').ilike('src', like), 'owner_id').limit(1),
    () => supabase.from('uni_lessons').select('id').ilike('video_src', like).limit(1),
    () => supabase.from('uni_files').select('id').ilike('video_src', like).limit(1),
    () => supabase.from('house_ads').select('id').eq('cloudflare_uid', uid).limit(1),
    () => notMine(supabase.from('crew_responses').select('id').eq('self_tape_uid', uid), 'user_id').limit(1),
    () => notMine(supabase.from('posts').select('id').eq('video_uid', uid), 'user_id').limit(1),
    // The creator path (migration 116): a master uploaded with an
    // application, and a draft's upload in flight.
    () => notMine(supabase.from('creator_applications').select('id').eq('video_uid', uid), 'user_id').limit(1),
    () => notMine(supabase.from('creator_drafts').select('id').or(`video_uid.eq.${uid},trailer_uid.eq.${uid}`), 'user_id').limit(1)
  ];
  for (const run of checks) {
    const { data, error } = await run();
    if (error) {
      if (missingRelation(error)) continue;
      console.error('videoOwnership lookup:', error.message);
      return true;
    }
    if (data && data.length) return true;
  }
  return false;
}

// Is anything on the site still pointing at this video? The orphan
// cleanup asks before it deletes one for good.
export async function videoInUse(uid) {
  const id = String(uid || '');
  if (!VIDEO_UID_PATTERN.test(id)) return false;
  return usedByOthers(id, null);
}

// → { ok: true, video } or { ok: false, status, error }. `allowUntagged`
// false for uploads that are always tagged (self-tapes): an untagged uid
// there can only be someone else's video.
export async function checkVideoOwnership(uid, { userId, isAdmin = false, allowUntagged = true } = {}) {
  const id = String(uid || '');
  if (!VIDEO_UID_PATTERN.test(id)) return { ok: false, status: 400, error: 'That doesn’t look like a video id from this site.' };
  const video = await getCloudflareVideoStatus(id);
  if (!video) return { ok: false, status: 404, error: 'No video found with that ID.' };
  if (isAdmin) return { ok: true, video };
  if (!userId) return { ok: false, status: 401, error: 'Sign in first.' };
  if (video.creator) {
    return video.creator === userId ? { ok: true, video } : { ok: false, status: 403, error: 'That video was uploaded by someone else.' };
  }
  if (!allowUntagged) return { ok: false, status: 403, error: 'Upload the video here first.' };
  if (await usedByOthers(id, userId)) return { ok: false, status: 403, error: 'That video is already used by someone else.' };
  return { ok: true, video };
}

// What a video-status poll may show its caller: everything but who
// uploaded it (a Clerk user id).
export function publicVideoStatus(video) {
  if (!video) return null;
  const { creator, ...rest } = video;
  return rest;
}
