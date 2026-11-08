import { getPodcastShowHubData } from '../../lib/podcastShowHub';
import { limitPublicRead } from '../../lib/rateLimit';
import { applyCors } from '../../lib/cors';

// The mobile app's equivalent of pages/podcasts/[id].js's
// getServerSideProps — same lib/podcastShowHub.js, same per-viewer
// entitled episode list (audioUrl/src already stripped server-side for
// anything the caller isn't entitled to). Leaves out mainGenres/email/
// isAdmin/isCreator — those only exist for the website's own HeaderNav.
//
// ?preview=1 (the series revamp, slice 4; the page's own ?preview=1): the
// owner's private preview of a podcast show that isn't public, for its
// owner, anyone with an episode in it and the team — strangers get the
// same 404 as a missing id. Each episode then carries `status` and
// `previewLock` ('held' | 'others' | null; a locked row has no audio or
// video), `resume` is empty and `preview` holds the bar's words.
export default async function handler(req, res) {
  // Browsers send an OPTIONS pre-check before any request carrying an
  // Authorization header (the app's web preview does); answer it.
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (!(await limitPublicRead(req, res, 'podcast-show'))) return undefined;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required.' });

  const data = await getPodcastShowHubData(id, req, { preview: req.query.preview === '1' });
  if (!data) return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    show: data.show,
    episodes: data.episodes,
    // episodeId -> seconds to pick up from (signed-in listeners only).
    resume: data.resume || {},
    isSignedIn: data.isSignedIn,
    isSubscriber: data.isSubscriber,
    // { role, state, strong, text, linkHref, linkLabel } in a preview of a
    // show that isn't public; null otherwise (a public show opened with
    // ?preview=1 is its ordinary page).
    preview: data.preview || null
  });
}
