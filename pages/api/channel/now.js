import { getChannelState } from '../../../lib/channelSchedule';

// Public, no auth — same trust level as the /channel page itself. Polled
// by ChannelPlayer both periodically (a safety net against drift) and
// specifically timed to fire right as the current program is expected to
// end, so the switch to the next one is prompt rather than waiting for the
// next slow poll.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const state = await getChannelState(new Date());
    return res.status(200).json(state);
  } catch (err) {
    console.error('channel/now error:', err.message);
    return res.status(200).json({ onAir: false, serverTime: new Date().toISOString() });
  }
}
