import { getRoleContext } from '../../../lib/roles';
import { isRedisConfigured, redisFetch } from '../../../lib/redis';

// Checking that the env vars exist isn't the same as confirming they're
// actually valid credentials pointing at a live database — a typo'd
// token or an expired/deleted database would still pass an "is it set"
// check but fail every real request. This does an actual SET/GET/DELETE
// round trip against Upstash and reports back what really happened.
export default async function handler(req, res) {
  const { isAdmin } = await getRoleContext(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  if (!isRedisConfigured()) {
    return res.status(200).json({
      connected: false,
      reason: 'not_configured',
      message: 'UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN are not set in this environment.'
    });
  }

  const testKey = `studio-tapa-connection-test:${Date.now()}`;
  const testValue = 'ok';

  try {
    const setResult = await redisFetch(['set', testKey, testValue]);
    if (!setResult || setResult.result !== 'OK') {
      return res.status(200).json({
        connected: false,
        reason: 'set_failed',
        message: 'The SET command did not return the expected result — credentials may be valid but something else is wrong.',
        raw: setResult
      });
    }

    const getResult = await redisFetch(['get', testKey]);
    // Clean up regardless of whether the value round-tripped correctly —
    // no reason to leave a test key behind either way.
    await redisFetch(['del', testKey]).catch(() => {});

    if (!getResult || getResult.result !== testValue) {
      return res.status(200).json({
        connected: false,
        reason: 'get_mismatch',
        message: 'Wrote a value successfully but reading it back did not return what was written.',
        raw: getResult
      });
    }

    return res.status(200).json({
      connected: true,
      message: 'Connected — successfully wrote and read a test value from Upstash.'
    });
  } catch (err) {
    // redisFetch throws with the HTTP status baked into the message
    // (e.g. "Upstash Redis error: 401") — surfacing that directly is more
    // actionable than a generic failure, since 401 vs 404 vs a network
    // error point to very different fixes (bad token vs deleted database
    // vs wrong URL).
    return res.status(200).json({
      connected: false,
      reason: 'request_failed',
      message: err.message
    });
  }
}
