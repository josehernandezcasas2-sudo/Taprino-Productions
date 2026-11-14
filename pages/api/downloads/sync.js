import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, syncDownloads } from '../../../lib/downloads';
import { cleanDeviceName, cleanHave, cleanPlatform, isDeviceId } from '../../../lib/downloadSiteRules';
import { isTitleId } from '../../../lib/titleIds';

// POST /api/downloads/sync { deviceId, deviceName, platform, have: [episodeId] }
// The phone's check-in (lib/downloads.js syncDownloads): it says which
// titles it holds (at most 60: finished, still downloading, paused or
// failed — anything start ever answered 200 for) and hears, for each one
// of them, what happens to it. A copy on record that it doesn't list is
// marked removed and its slot freed; an empty list says the phone lost
// everything (a reinstall) and frees them all — so `have` must be there
// and be a list: without one the check-in is refused, 400 { code: 'have' },
// and nothing is touched. A phone that never downloaded isn't put on
// record by a check-in.
//   200 { enabled, serverTime, paidThrough, plan: { carries, tier },
//         limits, deviceRemoved, items: [{ episodeId, state: 'ok' |
//         'paused' | 'ended' | 'revoked', basis, licensedUntil, endedAt,
//         keepUntil, reason }] }
// `reason` on a revoked item: 'title' (gone, held, or its maker switched
// downloads off), 'refund', 'device' (this phone was taken off the list),
// 'removed' (no copy of it is on record for this phone). Every date is an
// ISO string. A check-in that can't read the plan (Stripe, Clerk, the
// comped list, a promo's date), the purchases or the titles answers 503
// { code: 'unavailable' } and changes nothing: the phone keeps what it has.
// 400 { code: 'device' | 'have' } · 401 · 403 { code: 'app-only' } a
// browser (lib/downloadSiteRules.js looksLikeABrowser) · 403 { suspended:
// true } · 429 { code: 'rate', limit: 'requests' } · 503 { code:
// 'migration-123' | 'unavailable' }. 120 an hour per account.
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['POST'], scope: 'downloads-sync', perHour: 120, appOnly: true });
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
