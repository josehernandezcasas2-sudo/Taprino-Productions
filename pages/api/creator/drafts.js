import { getRoleContext } from '../../../lib/roles';
import { listDrafts, getDraft, saveDraft, deleteDraft } from '../../../lib/creatorDrafts';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { checkRateLimit } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';

// Creator Studio's drafts (the three-step submit page, web + app).
//   GET            → { drafts }         GET ?id= → { draft }
//   POST           { id?, form, video?, trailer? } → { draft }   (upsert)
//   DELETE         { id }               → { ok }  (the media goes too)
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId) return res.status(401).json({ error: 'Sign in first.' });
  if (!isCreator && !isAdmin) return res.status(403).json({ error: 'Creator access required.' });

  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const draft = await getDraft(userId, String(req.query.id));
        if (!draft) return res.status(404).json({ error: 'No such draft.' });
        return res.status(200).json({ draft });
      }
      return res.status(200).json({ drafts: await listDrafts(userId, { refresh: true }) });
    }

    if (req.method === 'POST') {
      if (!(await checkRateLimit(`creator-drafts:${userId}`, 240, 3600))) return res.status(429).json({ error: 'Saving too often. Give it a moment.' });
      const { id, form, video, trailer } = req.body || {};
      // A uid names a video in the Cloudflare account; it has to be this
      // creator's own upload (tagged by get-upload-url / import-video-url).
      for (const v of [video, trailer]) {
        if (v && v.uid) {
          if (!VIDEO_UID_PATTERN.test(String(v.uid))) return res.status(400).json({ error: 'That doesn’t look like a video id from this site.' });
          if (!isAdmin) {
            const owned = await checkVideoOwnership(String(v.uid), { userId });
            if (!owned.ok) return res.status(owned.status).json({ error: owned.error });
          }
        }
      }
      const draft = await saveDraft(userId, { id: id ? String(id) : null, form, video, trailer });
      return res.status(200).json({ draft });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      const ok = await deleteDraft(userId, String(id));
      return res.status(200).json({ ok });
    }

    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err, 'creator/drafts');
  }
}
