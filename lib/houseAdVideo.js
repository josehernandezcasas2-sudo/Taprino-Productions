import { getSupabase } from './supabase';
import { videoInUse, VIDEO_UID_PATTERN } from './videoOwnership';

// SERVER-ONLY. Which Cloudflare video a house ad may be made from
// (2026-11-15). Making one turns on Cloudflare's downloadable MP4 for the
// video and puts that MP4's address in the ad's public VAST, so a house ad
// takes a video nothing else on the site uses: a fresh
// upload from the house-ads page, or one a house ad already has (its MP4
// is on already; nothing new is handed out).
// → null, or { status, error } to answer with.
export async function houseAdVideoRefusal(uid) {
  const id = String(uid || '');
  if (!VIDEO_UID_PATTERN.test(id)) return { status: 400, error: 'That doesn’t look like a video id from this site.' };
  if (!(await videoInUse(id))) return null;
  const { data, error } = await getSupabase().from('house_ads').select('id').eq('cloudflare_uid', id).limit(1);
  if (error) {
    console.error('houseAdVideoRefusal:', error.message);
    return { status: 503, error: 'Couldn’t check that video just now. Try again in a minute.' };
  }
  if (data && data.length) return null;
  return { status: 403, error: 'That video is used elsewhere on the site. Upload the ad’s own video here.' };
}
