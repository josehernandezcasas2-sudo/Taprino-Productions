import { getChannelState } from '../../../lib/channelSchedule';

// Public, no auth — same trust level as the /channel page itself. Polled
// by ChannelPlayer both periodically (a safety net against drift) and
// specifically timed to fire right as the current program is expected to
// end, so the switch to the next one is prompt rather than waiting for the
// next slow poll.
export default async function handler(req, res) {
  // Polled by every viewer on /channel, and the response is identical for
  // all of them — no auth, no per-user data. A 10-second CDN cache means a
  // hundred concurrent viewers cost one invocation per 10s instead of a
  // hundred. Short enough that a program change still lands promptly, and
  // the player re-derives its own position from serverTime regardless.
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  try {
    const state = await getChannelState(new Date());
    return res.status(200).json(state);
  } catch (err) {
    console.error('channel/now error:', err.message);
    return res.status(200).json({ onAir: false, serverTime: new Date().toISOString() });
  }
}
