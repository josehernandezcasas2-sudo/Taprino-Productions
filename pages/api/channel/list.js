import { listChannels, getChannelNow, channelToPublic } from '../../../lib/channelEngine';

// Public: every public channel, in number order, with what's on each right
// now. The website gets this from getServerSideProps (lib/livePageProps.js);
// the mobile app's Live screen calls this instead.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const channels = await listChannels();
    const at = new Date();
    const states = await Promise.all(channels.map((c) => getChannelNow(c, at).catch(() => null)));
    // CDN-only cache; clients always fetch fresh (see now.js).
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=15, stale-while-revalidate=60');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      channels: channels.map((c, i) => {
        const s = states[i];
        return {
          ...channelToPublic(c),
          isLive: !!(s && s.live),
          nowTitle: s ? (s.live ? s.live.title : s.program ? (s.program.seriesName || s.program.title) : null) : null
        };
      })
    });
  } catch (err) {
    console.error('channel/list error:', err.message);
    return res.status(500).json({ error: 'Channels are unavailable right now.' });
  }
}
