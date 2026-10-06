import { getChannelNow } from '../../../lib/channelEngine';
import { resolvePublicChannel } from '../../../lib/channelRequest';

// Public, no auth: what's airing on a channel right now. Same answer for
// every viewer and never contains a playable URL (see /api/channel/play),
// so a short CDN cache is safe. Polled by the channel player, and fired
// right as the current program is due to end.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const channel = await resolvePublicChannel(req.query.channel);
    if (!channel) return res.status(404).json({ error: 'No such channel.' });
    const state = await getChannelNow(channel, new Date());
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return res.status(200).json(state);
  } catch (err) {
    console.error('channel/now error:', err.message);
    return res.status(200).json({ onAir: false, serverTime: new Date().toISOString(), error: 'unavailable' });
  }
}
