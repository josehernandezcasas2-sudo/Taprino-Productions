import { getCurrentLiveStream } from '../../../lib/liveStreams';

// Public, no auth — polled by the /live page and its player to notice a
// broadcast starting or ending without the viewer needing to refresh. Same
// trust level as watching a live broadcast on any site: nothing here is
// sensitive, it's exactly what a signed-out visitor to /live would already
// see rendered into the page.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const stream = await getCurrentLiveStream();
  if (!stream) {
    return res.status(200).json({ live: false });
  }
  return res.status(200).json({ live: true, stream });
}
