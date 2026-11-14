import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, startDownload } from '../../../lib/downloads';
import { cleanDeviceName, cleanPlatform, isDeviceId } from '../../../lib/downloadSiteRules';
import { isTitleId } from '../../../lib/titleIds';

// POST /api/downloads/start { episodeId, deviceId, deviceName, platform }
// (the app also sends its viewing-terms flag the way playback does:
// `terms: 1`). The one route that hands out a link to a title's file, so
// who may have it is decided here from the session on every call
// (lib/downloads.js startDownload): the playback gate first — the same
// answers playback gives — then the download rules, the limits and
// Cloudflare.
//   200 { ready: true, url, expiresAt, basis, licensedUntil, serverTime,
//         paidThrough, item: { episodeId, title, kicker, seriesId,
//         seriesName, season, number, contentType, runtimeSeconds, rating,
//         art, hasCaptions, hasFlashingLights } }
//   202 { ready: false, percent }   Cloudflare is making the file: ask again
//   401 signed out · 403 { code: 'app-only' } a browser · 403 { suspended:
//   true } · 403 the gate's own answers (age, terms, early screening,
//   plan) · 403 { code: 'off' | 'title' | 'plan' } · 404 · 409 { code:
//   'titles' } / { code: 'devices', devices } · 422 { code: 'kind' } ·
//   429 { code: 'rate', limit: 'hour' | 'day' | 'requests', retryAfter } ·
//   503 { code: 'migration-123' | 'cloudflare' | 'unavailable' }
// Every date is an ISO string. Asking again for a title the phone already
// holds, or is waiting for, is the same call (never refused by a limit; a
// fresh link and a renewed date). The route may be asked every few seconds
// while a file is being made: 600 asks an hour per account (`limit:
// 'requests'`). New copies — a title the phone doesn't hold yet, counted
// at its first ask — are 30 an hour and 60 a day per account (`limit:
// 'hour' | 'day'`). A 429 means wait `retryAfter` seconds, not fail.
//
// Only the app: a request with an Origin or a Sec-Fetch-Site header, or
// without an Authorization: Bearer token, is refused 403 { code:
// 'app-only' } (lib/downloadSiteRules.js looksLikeABrowser — a speed
// bump, not a lock).
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-start', perHour: 600, appOnly: true });
    if (!account) return undefined;
    const body = bodyOf(req);
    if (typeof body.episodeId !== 'string' || !isTitleId(body.episodeId)) throw new DownloadError('Which title?', 400, { code: 'title-id' });
    if (!isDeviceId(body.deviceId)) throw new DownloadError('That isn’t a phone’s id.', 400, { code: 'device' });
    const result = await startDownload(req, {
      episodeId: body.episodeId,
      deviceId: body.deviceId,
      deviceName: cleanDeviceName(body.deviceName),
      platform: cleanPlatform(body.platform)
    }, { account });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return downloadRouteError(res, err, 'downloads/start');
  }
}
