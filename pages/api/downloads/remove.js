import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, removeCopy } from '../../../lib/downloads';
import { isDeviceId } from '../../../lib/downloadSiteRules';
import { isTitleId } from '../../../lib/titleIds';

// POST /api/downloads/remove { deviceId, episodeId } → { ok: true }
// The phone deleted its copy of a title: the slot is free at once. A copy
// that isn't on record answers the same. 401 · 403 { code: 'app-only' } a
// browser (lib/downloadSiteRules.js looksLikeABrowser) · 403 { suspended:
// true } · 429 · 503 { code: 'migration-123' | 'unavailable' }.
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-remove', perHour: 240, appOnly: true });
    if (!account) return undefined;
    const body = bodyOf(req);
    if (!isDeviceId(body.deviceId)) throw new DownloadError('That isn’t a phone’s id.', 400, { code: 'device' });
    if (typeof body.episodeId !== 'string' || !isTitleId(body.episodeId)) throw new DownloadError('Which title?', 400, { code: 'title-id' });
    return res.status(200).json(await removeCopy(account, { deviceId: body.deviceId, episodeId: body.episodeId }));
  } catch (err) {
    return downloadRouteError(res, err, 'downloads/remove');
  }
}
