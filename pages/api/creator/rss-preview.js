import { getRoleContext } from '../../../lib/roles';
import { validateRemoteVideoUrl } from '../../../lib/urlValidation';
import { parsePodcastFeed } from '../../../lib/rssImport';

const MAX_FEED_BYTES = 10 * 1024 * 1024; // 10MB — generous for even a very long-running show's feed XML
const FETCH_TIMEOUT_MS = 20000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { isCreator, isAdmin } = await getRoleContext(req);
  if (!isCreator && !isAdmin) {
    return res.status(403).json({ error: 'Creator access required.' });
  }

  const { feedUrl } = req.body || {};
  // Same SSRF-safe validation as any other server-fetched URL — this
  // server does the fetching itself, same reasoning as audio import.
  const check = validateRemoteVideoUrl(feedUrl);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(check.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'StudioTapaRssImport/1.0', Accept: 'application/rss+xml, application/xml, text/xml' }
    });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(502).json({ error: err.name === 'AbortError' ? 'That feed took too long to respond.' : `Could not reach that feed: ${err.message}` });
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return res.status(502).json({ error: `That feed returned an error (${response.status}).` });
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_FEED_BYTES) {
    return res.status(400).json({ error: 'That feed file is unusually large — this only supports standard podcast RSS feeds.' });
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_FEED_BYTES) {
    return res.status(400).json({ error: 'That feed file is unusually large — this only supports standard podcast RSS feeds.' });
  }

  try {
    const parsed = parsePodcastFeed(text);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
