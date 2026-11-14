import { startDownloadRoute, downloadRouteError, bodyOf } from '../../../lib/downloadRoute';
import { DownloadError, listPhones, removePhone } from '../../../lib/downloads';
import { isDeviceId } from '../../../lib/downloadSiteRules';

// The phones an account downloads on (lib/downloads.js).
//   GET  → { devices: [{ deviceId, name, platform, lastSeenAt, count, current }] }
//   POST { remove: deviceId } → { ok: true, devices }: that phone leaves
//     the list and its copies are taken back; it hears `deviceRemoved` at
//     its next check-in. Removing one that isn't there changes nothing.
// The website's /downloads page and the app's sign-out both use the POST,
// so a browser is welcome here (unlike start, sync and remove).
// 401 · 403 { suspended: true } · 429 · 503 { code: 'migration-123' |
// 'unavailable' }.
export default async function handler(req, res) {
  try {
    const post = req.method === 'POST';
    const account = await startDownloadRoute(req, res, { methods: ['GET', 'POST'], scope: post ? 'downloads-phone-remove' : 'downloads-phones', perHour: post ? 60 : 240 });
    if (!account) return undefined;
    if (!post) return res.status(200).json({ devices: await listPhones(account) });
    const body = bodyOf(req);
    if (!isDeviceId(body.remove)) throw new DownloadError('Which phone?', 400, { code: 'device' });
    return res.status(200).json({ ok: true, devices: await removePhone(account, body.remove) });
  } catch (err) {
    return downloadRouteError(res, err, 'downloads/devices');
  }
}
