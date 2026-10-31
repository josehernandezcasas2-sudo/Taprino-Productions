import { getRoleContext } from '../../../lib/roles';
import { getSupabase } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rateLimit';
import { getApplication, toApplicantView, deleteApplicationVideo, isOpenStatus } from '../../../lib/creatorApplications';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { updateCompat } from '../../../lib/dbCompat';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// Replace the master on an open application (a held one above all: "the
// music isn't licensed, swap it and it goes live"). The old video is
// deleted from Cloudflare, the new upload takes its place, and a held
// application comes back to Reviewing.
const VIDEO_COLUMNS = ['video_uid', 'video_state', 'video_name', 'video_bytes', 'upload_url', 'runtime_seconds', 'held_at'];

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!(await checkRateLimit(`apply-video:${userId}`, 5, 3600))) return res.status(429).json({ error: 'That’s a few replacements in a row. Give it an hour.' });

  const { id, videoUid, videoName, videoBytes, runtimeSeconds, uploadUrl } = req.body || {};
  if (!id || !videoUid) return res.status(400).json({ error: 'id and videoUid are required.' });
  if (!VIDEO_UID_PATTERN.test(String(videoUid))) return res.status(400).json({ error: 'That doesn’t look like a video id from this site.' });

  const row = await getApplication(id);
  if (!row || row.user_id !== userId) return res.status(404).json({ error: 'No such application.' });
  if (!isOpenStatus(row.status)) return res.status(409).json({ error: 'This application is closed. Send a new one.' });

  const owned = await checkVideoOwnership(String(videoUid), { userId, allowUntagged: false });
  if (!owned.ok) return res.status(owned.status).json({ error: owned.error });
  const st = owned.video.state;
  const videoState = st === 'pendingupload' ? 'uploading' : (st === 'ready' || owned.video.readyToStream) ? 'ready' : st === 'error' ? 'error' : 'processing';

  if (row.video_uid && row.video_uid !== String(videoUid)) await deleteApplicationVideo(row.video_uid);

  const patch = {
    video_uid: String(videoUid),
    video_state: videoState,
    video_name: typeof videoName === 'string' ? videoName.trim().slice(0, 200) : null,
    video_bytes: Number(videoBytes) > 0 ? Math.round(Number(videoBytes)) : null,
    upload_url: typeof uploadUrl === 'string' && /^https?:\/\//.test(uploadUrl) ? uploadUrl.slice(0, 1000) : null,
    runtime_seconds: Number(runtimeSeconds) > 0 ? Math.round(Number(runtimeSeconds)) : null
  };
  if (row.status === 'held') Object.assign(patch, { status: 'reviewing', held_at: null });

  const { data, error } = await updateCompat(getSupabase(), 'creator_applications', patch, VIDEO_COLUMNS, (q) => q.eq('id', id).select().single());
  if (error) return sendError(res, error, 'apply/video', 'Could not attach the new file.');
  return res.status(200).json({ ok: true, application: toApplicantView(data) });
}
