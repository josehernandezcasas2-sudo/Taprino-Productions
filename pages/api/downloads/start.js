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
// holds, or is waiting for, is the same call (never refused by the new-
// copy limits; a fresh link and a renewed date). The route may be asked
// every few seconds while a file is being made: ASKS_PER_HOUR an hour per
// account (`limit: 'requests'`). New copies — a title the phone doesn't
// hold yet, counted at its first ask — are 30 an hour and 60 a day per
// account (`limit: 'hour' | 'day'`). A 429 means wait `retryAfter`
// seconds, not fail.
//
// ASKS_PER_HOUR was 600 until 2026-11-16. Every ask reaches Cloudflare's
// API (the status read, and a token unless the local signing key is set)
// — the allowance playback tokens are minted through, about 1,200 calls in
// five minutes before every call is blocked for five — and an hour's 600
// could be spent in one burst. 400 is what the app's own schedule needs
// for a season (mobile/src/lib/downloadLogic.js preparePollDelay; scripts/
// test-download-logic.mjs works it out): 13 episodes whose files each take
// Cloudflare five minutes ask 377 times, a full phone of 25 whose files
// take a minute 325. Cheaper asks belong in lib/downloads.js (one status
// read per video shared for a few seconds) and the signing key.
//
// Only the app: a request with an Origin or a Sec-Fetch-Site header, or
// without an Authorization: Bearer token, is refused 403 { code:
// 'app-only' } (lib/downloadSiteRules.js looksLikeABrowser — a speed
// bump, not a lock).
const ASKS_PER_HOUR = 400;

export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-start', perHour: ASKS_PER_HOUR, appOnly: true });
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
