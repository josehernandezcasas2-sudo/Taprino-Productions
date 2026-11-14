import { startDownloadRoute, downloadRouteError } from '../../../lib/downloadRoute';
import { DownloadError, getDownloads } from '../../../lib/downloads';
import { isDeviceId } from '../../../lib/downloadSiteRules';

// Downloads in the app (2026-11-14; lib/downloads.js, contract
// mockups/app-downloads-contract.md).
//   GET ?deviceId= → { enabled, plan: { carries, tier }, limits: { titles,
//     devices }, devices: [{ deviceId, name, platform, lastSeenAt, count,
//     current }], items: [{ episodeId, basis, licensedUntil, endedAt }] }
// `devices`: the account's phones that hold a copy (and the one asking,
// once it has downloaded). `items`: the live copies on the phone asking
// (none without a deviceId: the website asks without one). Every date is
// an ISO string. Signed in (401), not suspended (403 { suspended: true });
// before migration 123 it answers 503 { code: 'migration-123' }.
export default async function handler(req, res) {
  try {
    const account = await startDownloadRoute(req, res, { methods: ['GET'], scope: 'downloads-read', perHour: 240 });
    if (!account) return undefined;
    const raw = req.query && req.query.deviceId;
    const deviceId = typeof raw === 'string' && raw !== '' ? raw : null;
    if (deviceId !== null && !isDeviceId(deviceId)) throw new DownloadError('That isn’t a phone’s id.', 400, { code: 'device' });
    return res.status(200).json(await getDownloads(account, deviceId));
  } catch (err) {
    return downloadRouteError(res, err, 'downloads');
  }
}
