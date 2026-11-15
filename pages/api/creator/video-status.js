import { getRoleContext } from '../../../lib/roles';
import { checkVideoOwnership, publicVideoStatus } from '../../../lib/videoOwnership';
import { limitPublicRead } from '../../../lib/rateLimit';

// Polled every few seconds by the creator's browser while a link import (or
// a regular upload) is being fetched/transcoded on Cloudflare's side.
//
// It runs before an episode row exists, so the only thing to check is the
// video itself: it has to be this creator's own upload (tagged by
// get-upload-url / import-video-url), or an untagged older video nobody
// else uses. Until 2026-10-26 it answered for any uid in the account,
// uploader id included, which made other people's videos easy to probe.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { uid } = req.query;
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required.' });
  }

  // A poll every 3–4 s is 1,200 an hour for one upload; the limit leaves
  // room for that and a second tab, and the answer is at most a few
  // seconds old so the upload's progress moves (lib/cloudflareUpload.js
  // keeps a minute for lists of many uploads).
  if (!(await limitPublicRead(req, res, 'creator-video-status', { max: 2400, windowSeconds: 3600, userId }))) return;
  const owned = await checkVideoOwnership(uid, { userId, isAdmin, maxAgeMs: 2500 });
  if (!owned.ok) {
    // Same answer for "not yours" and "doesn't exist".
    return res.status(owned.status === 400 ? 400 : 404).json({ error: owned.status === 400 ? owned.error : 'No video found with that ID.' });
  }

  return res.status(200).json(isAdmin ? owned.video : publicVideoStatus(owned.video));
}
