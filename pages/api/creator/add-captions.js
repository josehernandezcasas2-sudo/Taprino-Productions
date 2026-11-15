import { getRoleContext } from '../../../lib/roles';
import { checkRateLimit } from '../../../lib/rateLimit';
import { isTitleId } from '../../../lib/titleIds';
import { setEpisodeCaptions } from '../../../lib/showPage';
import { showRouteError } from '../../../lib/showRoute';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};

// A title's captions track, by the person who uploaded it (the episode
// editors' Captions card, web; the app points to the website).
//
//   POST { episodeId, captionsBase64, captionsFileName, language, label }
//   POST { episodeId, remove: true }
//
// Tracks go to the private bucket (lib/captionUpload.js) and play through
// /api/captions/<id>. Until 2026-11-15 a new track applied at once on any
// title; since then (Jose: "make sure any caption change or anything to
// change the series/live titles needs review") on a live title it waits in
// migration 124's pending_fields.captions and viewers keep the live track
// until someone on the team approves it (lib/stagedChanges.js) — removing
// the captions waits the same way. On a title in review, declined or
// pulled it applies at once as before, and a full admin's own change too.
// Before 124 a change that would wait answers 503 migration-124. The work
// is lib/showPage.js setEpisodeCaptions.
//   → { ok, staged, removed?, url?, cueCount?, converted?, message? }
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, isCreator, isAdmin } = await getRoleContext(req);
  if (!userId || (!isCreator && !isAdmin)) {
    return res.status(403).json({ error: 'Creator access required.' });
  }
  // A track in private storage per call (security round 2).
  if (!(await checkRateLimit(`add-captions:${userId}`, 20, 3600))) {
    return res.status(429).json({ error: 'Too many caption changes in a row — give it a little while.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const episodeId = body.episodeId === undefined || body.episodeId === null ? '' : String(body.episodeId);
  if (!episodeId || !isTitleId(episodeId)) {
    return res.status(400).json({ error: 'episodeId is required.' });
  }

  try {
    const result = await setEpisodeCaptions(episodeId, {
      captionsBase64: body.captionsBase64,
      captionsFileName: body.captionsFileName,
      language: body.language,
      label: body.label,
      remove: body.remove === true
    }, { userId, isAdmin: isAdmin === true });
    return res.status(200).json(result);
  } catch (err) {
    return showRouteError(res, err, 'creator/add-captions', 'Could not save the captions.');
  }
}
