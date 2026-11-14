import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, syncDownloads } from '../../../lib/downloads';
import { cleanDeviceName, cleanHave, cleanPlatform, isDeviceId } from '../../../lib/downloadSiteRules';
import { isTitleId } from '../../../lib/titleIds';

// POST /api/downloads/sync { deviceId, deviceName, platform, have: [episodeId] }
// The phone's check-in (lib/downloads.js syncDownloads): it says which
// titles it holds (at most 60) and hears, for each, what happens to it.
//   200 { enabled, serverTime, paidThrough, plan: { carries, tier },
//         limits, deviceRemoved, items: [{ episodeId, state: 'ok' |
//         'paused' | 'ended' | 'revoked', basis, licensedUntil, endedAt,
//         keepUntil, reason }] }
// `reason` on a revoked item: 'title' (gone, held, or its maker switched
// downloads off), 'refund', 'device' (this phone was taken off the list),
// 'removed' (no copy of it is on record for this phone). Every date is an
// ISO string. A check-in that can't read the plan, the purchases or the
// titles answers 5xx and changes nothing: the phone keeps what it has.
// 401 · 403 { suspended: true } · 429 · 503 { code: 'migration-123' |
// 'unavailable' }. 120 an hour per account.
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-sync', perHour: 120 });
    if (!account) return undefined;
    const body = bodyOf(req);
    if (!isDeviceId(body.deviceId)) throw new DownloadError('That isn’t a phone’s id.', 400, { code: 'device' });
    const have = cleanHave(body.have, isTitleId);
    if (!have.ok) throw new DownloadError(have.error, 400, { code: 'have' });
    return res.status(200).json(await syncDownloads(account, {
      deviceId: body.deviceId,
      deviceName: cleanDeviceName(body.deviceName),
      platform: cleanPlatform(body.platform),
      have: have.ids
    }));
  } catch (err) {
    return downloadRouteError(res, err, 'downloads/sync');
  }
}
