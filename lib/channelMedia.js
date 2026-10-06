import { getSupabase } from './supabase';
import { cloudflarePlaybackUrl, cloudflareUidFromUrl, getCloudflareVideoStatus } from './cloudflareUpload';

// Channel-only uploads: bumpers, station IDs, promos and shows a Content
// Scheduler uploads that only ever play on channels (never on-demand).
// They wait for admin review like any creator submission, and can't be
// scheduled until approved. Uploads meant for on-demand too go through the
// normal Creator Studio submission instead.

export const MEDIA_KINDS = { bumper: 'Bumper', station_id: 'Station ID', promo: 'Promo', show: 'Show' };
const FIELDS = 'id, owner_id, title, kind, src, duration_seconds, thumbnail, status, rejection_reason, moderation_hold, created_at';

function toPublic(m) {
  return {
    id: m.id,
    ownerId: m.owner_id,
    title: m.title,
    kind: m.kind,
    kindLabel: MEDIA_KINDS[m.kind] || m.kind,
    durationSeconds: m.duration_seconds || null,
    thumbnail: m.thumbnail || null,
    status: m.status,
    rejectionReason: m.rejection_reason || null,
    held: !!m.moderation_hold,
    createdAt: m.created_at
  };
}

// Cloudflare only knows a video's length once it finishes processing, so
// rows saved straight after an upload are filled in on the next look.
async function fillInFromCloudflare(rows) {
  const supabase = getSupabase();
  await Promise.all(rows.filter((m) => !m.duration_seconds && m.src).map(async (m) => {
    const status = await getCloudflareVideoStatus(cloudflareUidFromUrl(m.src));
    if (status && status.duration) {
      m.duration_seconds = Math.round(status.duration);
      m.thumbnail = m.thumbnail || status.thumbnail;
      await supabase.from('channel_media').update({ duration_seconds: m.duration_seconds, thumbnail: m.thumbnail }).eq('id', m.id);
    }
  }));
  return rows;
}

// A scheduler's own uploads; an admin sees everyone's.
export async function listChannelMedia({ ownerId, all = false, status } = {}) {
  const supabase = getSupabase();
  let q = supabase.from('channel_media').select(FIELDS).order('created_at', { ascending: false });
  if (!all) q = q.eq('owner_id', ownerId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (await fillInFromCloudflare(data || [])).map(toPublic);
}

export async function createChannelMedia({ ownerId, title, kind, videoUid }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Give the upload a title.');
  if (cleanTitle.length > 120) throw new Error('Keep the title to 120 characters or fewer.');
  if (!MEDIA_KINDS[kind]) throw new Error('Pick what kind of upload this is.');
  if (!videoUid || typeof videoUid !== 'string') throw new Error('The video upload is missing.');
  const src = cloudflarePlaybackUrl(videoUid);
  if (!src) throw new Error('Could not resolve the uploaded video. Is Cloudflare Stream configured?');
  // Make sure the uid is a real video in this account, not just any string.
  const status = await getCloudflareVideoStatus(videoUid);
  if (!status) throw new Error("That video couldn't be found in Cloudflare.");

  const { data, error } = await getSupabase().from('channel_media').insert({
    owner_id: ownerId,
    title: cleanTitle,
    kind,
    src,
    duration_seconds: status.duration ? Math.round(status.duration) : null,
    thumbnail: status.thumbnail || null,
    status: 'pending'
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

// Deleting also takes it off every schedule (slots cascade).
export async function deleteChannelMedia({ id, userId, isAdmin }) {
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('channel_media').select('owner_id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return;
  if (!isAdmin && row.owner_id !== userId) throw new Error('You can only delete your own uploads.');
  const { error: delErr } = await supabase.from('channel_media').delete().eq('id', id);
  if (delErr) throw new Error(delErr.message);
}

export async function reviewChannelMedia({ id, action, reason, adminId }) {
  const supabase = getSupabase();
  const { data: row, error } = await supabase.from('channel_media').select(FIELDS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('That upload no longer exists.');
  if (action === 'approve') {
    const [filled] = await fillInFromCloudflare([row]);
    if (!filled.duration_seconds) throw new Error("Cloudflare is still processing this video. Try again in a minute.");
  } else if (action === 'reject') {
    if (!String(reason || '').trim()) throw new Error('Say why, so the scheduler knows what to fix.');
  } else {
    throw new Error('action must be approve or reject.');
  }
  const { error: upErr } = await supabase.from('channel_media').update({
    status: action === 'approve' ? 'approved' : 'rejected',
    rejection_reason: action === 'reject' ? String(reason).trim().slice(0, 500) : null,
    reviewed_by: adminId,
    reviewed_at: new Date().toISOString()
  }).eq('id', id);
  if (upErr) throw new Error(upErr.message);
}

export async function getChannelMediaSrc(id) {
  const { data, error } = await getSupabase().from('channel_media').select('src').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.src : null;
}
