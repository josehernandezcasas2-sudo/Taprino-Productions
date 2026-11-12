import { getRoleContext } from '../../../lib/roles';
import { listDrafts, getDraft, saveDraft, patchDraft, deleteDraft } from '../../../lib/creatorDrafts';
import { checkVideoOwnership, VIDEO_UID_PATTERN } from '../../../lib/videoOwnership';
import { checkRateLimit } from '../../../lib/rateLimit';
import { applyCors } from '../../../lib/cors';
import { sendError } from '../../../lib/apiErrors';
import { isTitleId } from '../../../lib/titleIds';
import { wellFormedBody } from '../../../lib/wellFormed';

// Creator Studio's drafts (the three-step submit page, web + app).
//   GET            → { drafts }         GET ?id= → { draft }
//                  ?seriesId= keeps one show's drafts; ?limit= (at most
//                  100, the default) — lib/creatorDrafts.js listDrafts
//   POST           { id?, form, video?, trailer? } → { draft }   (upsert:
//                  the whole draft, form, video and trailer together)
//   PATCH          { id, form?, video?, trailer? } → { draft }   (a partial
//                  change, lib/draftPatch.js: the form's keys sent replace
//                  those keys, the rest are kept; video / trailer only when
//                  sent, null clears — so the upload queue and the draft
//                  editor can't put back each other's older copy; 409 if
//                  the draft kept changing while it was merged)
//   DELETE         { id }               → { ok }  (the media goes too)
// A partial change is its own method, not a flag on POST: a server from
// before it answers a PATCH with 405 instead of reading the change as a
// whole draft and emptying the rest.
export default async function handler(req, res) {
  // A lone surrogate in any text would make Postgres refuse the save
  // (a 500): every string in the body is made well formed first.
  wellFormedBody(req);
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
      const seriesId = typeof req.query.seriesId === 'string' && isTitleId(req.query.seriesId) ? req.query.seriesId : null;
      if (req.query.seriesId !== undefined && !seriesId) return res.status(400).json({ error: 'Which show?' });
      const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
      return res.status(200).json({ drafts: await listDrafts(userId, { refresh: true, seriesId, limit }) });
    }

    // A uid names a video in the Cloudflare account; it has to be this
    // creator's own upload (tagged by get-upload-url / import-video-url).
    const refuseMedia = async (list) => {
      for (const v of list) {
        if (v && v.uid) {
          if (!VIDEO_UID_PATTERN.test(String(v.uid))) return { status: 400, error: 'That doesn’t look like a video id from this site.' };
          if (!isAdmin) {
            const owned = await checkVideoOwnership(String(v.uid), { userId });
            if (!owned.ok) return { status: owned.status, error: owned.error };
          }
        }
      }
      return null;
    };

    if (req.method === 'POST') {
      if (!(await checkRateLimit(`creator-drafts:${userId}`, 240, 3600))) return res.status(429).json({ error: 'Saving too often. Give it a moment.' });
      const { id, form, video, trailer } = req.body || {};
      const refused = await refuseMedia([video, trailer]);
      if (refused) return res.status(refused.status).json({ error: refused.error });
      const draft = await saveDraft(userId, { id: id ? String(id) : null, form, video, trailer });
      return res.status(200).json({ draft });
    }

    if (req.method === 'PATCH') {
      if (!(await checkRateLimit(`creator-drafts:${userId}`, 240, 3600))) return res.status(429).json({ error: 'Saving too often. Give it a moment.' });
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      if (!body.id) return res.status(400).json({ error: 'Which draft?' });
      const change = {};
      if (body.form !== undefined) {
        if (!body.form || typeof body.form !== 'object' || Array.isArray(body.form)) return res.status(400).json({ error: 'The form has to be a set of fields.' });
        change.form = body.form;
      }
      for (const key of ['video', 'trailer']) {
        if (body[key] === undefined) continue;
        if (body[key] !== null && (typeof body[key] !== 'object' || Array.isArray(body[key]))) return res.status(400).json({ error: `The ${key} has to be a set of fields, or null.` });
        change[key] = body[key];
      }
      const refused = await refuseMedia([change.video, change.trailer]);
      if (refused) return res.status(refused.status).json({ error: refused.error });
      const draft = await patchDraft(userId, String(body.id), change);
      return res.status(200).json({ draft });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      const ok = await deleteDraft(userId, String(id));
      return res.status(200).json({ ok });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sendError(res, err, 'creator/drafts');
  }
}
