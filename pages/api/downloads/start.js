import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, startDownload } from '../../../lib/downloads';
import { cleanDeviceName, cleanPlatform, isDeviceId } from '../../../lib/downloadSiteRules';
import { isTitleId } from '../../../lib/titleIds';

// POST /api/downloads/start { episodeId, deviceId, deviceName, platform }
// (the app also sends its viewing-terms flag the way playback does:
// `terms: 1`). The one route that hands out a link to a title's file, so
// who may have it is decided here from the session on every call
// (lib/downloads.js startDownload): the playback gate first — the same
// answers playback gives — then the download rules, the two limits and
// Cloudflare.
//   200 { ready: true, url, expiresAt, basis, licensedUntil, paidThrough,
//         item: { episodeId, title, kicker, seriesId, seriesName, season,
//         number, contentType, runtimeSeconds, rating, art, hasCaptions } }
//   202 { ready: false, percent }   Cloudflare is making the file: ask again
//   401 signed out · 403 { suspended: true } · 403 the gate's own answers
//   (age, terms, early screening, plan) · 403 { code: 'off' | 'title' |
//   'plan' } · 404 · 409 { code: 'titles' } / { code: 'devices', devices }
//   · 422 { code: 'kind' } · 429 { code: 'rate' } · 503 { code:
//   'migration-123' | 'cloudflare' | 'unavailable' }
// Every date is an ISO string. The route may be asked every few seconds
// while a file is being made (600 an hour per account); links themselves
// are limited to 60 an hour per account.
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-start', perHour: 600 });
    if (!account) return undefined;
    const body = bodyOf(req);
    if (typeof body.episodeId !== 'string' || !isTitleId(body.episodeId)) throw new DownloadError('Which title?', 400, { code: 'title-id' });
    if (!isDeviceId(body.deviceId)) throw new DownloadError('That isn’t a phone’s id.', 400, { code: 'device' });
    const result = await startDownload(req, {
      episodeId: body.episodeId,
      deviceId: body.deviceId,
      deviceName: cleanDeviceName(body.deviceName),
      platform: cleanPlatform(body.platform)
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return downloadRouteError(res, err, 'downloads/start');
  }
}
