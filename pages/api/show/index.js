import { startShowRoute, showViewer, showLimit, showRouteError } from '../../../lib/showRoute';
import { EXTRA_KIND_121_MSG, createShowFromForm, extraKindsReady, listShowSummaries } from '../../../lib/showPage';

// The creator's shows (the series revamp, slice 2; mockups/series-slice2-api.md).
//   GET  ?mine=1 (the default)  → { shows, extraKind }: the hub's "Your
//        shows" strip, Your work's group headers and the show pickers
//        (lib/showPage.js listShowSummaries); ?all=1 lists every show, for
//        the team. extraKind = { ready } (+ the line when not): whether
//        migration 121 is in, so the three-step submit can grey "What kind
//        of extra?" before it is.
//   POST { name, kind, description, defaults, posterBase64, thumbnailBase64,
//        cutFromFirst, releaseYear, fundingUrl, channelOptIn, credits }
//        → { ok, id, name, kind, status, href, cutArtPending }: New show.

// Poster and still arrive as data URLs.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['GET', 'POST'])) return;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return;
    if (req.method === 'GET') {
      if (!(await showLimit(req, res, viewer, 'show-list', 240))) return;
      const all = req.query.all === '1' && viewer.canAccessAdmin;
      const [shows, kindsReady] = await Promise.all([listShowSummaries(viewer, { all }), extraKindsReady().catch(() => true)]);
      return res.status(200).json({ shows, extraKind: kindsReady ? { ready: true } : { ready: false, line: EXTRA_KIND_121_MSG } });
    }
    // The same key as /api/creator/create-series: 10 new shows an hour.
    if (!(await showLimit(req, res, viewer, 'create-series', 10))) return;
    const made = await createShowFromForm(req.body || {}, viewer);
    return res.status(200).json(made);
  } catch (err) {
    return showRouteError(res, err, 'show', 'Could not create the show.');
  }
}
