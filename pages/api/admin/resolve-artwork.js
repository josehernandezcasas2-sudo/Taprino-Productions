import { requireCapability } from '../../../lib/adminAuth';
import { isTitleId } from '../../../lib/titleIds';
import { applyCors } from '../../../lib/cors';
import { showRouteError } from '../../../lib/showRoute';
import { STAGED_FIELDS, decideStaged, waitingFields } from '../../../lib/stagedChanges';
// What the Library's list showed waiting ({ field: mark }, from
// pending-artwork / pending-edits): only those fields are decided, and a
// change replaced since the list was read is refused (lib/stagedChanges.js).
// Without it (an older page) every field waiting now is decided.
function seenFields(target, raw, group) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map = STAGED_FIELDS[target] || {};
  const seen = {};
  for (const [f, mark] of Object.entries(raw)) {
    if (Object.prototype.hasOwnProperty.call(map, f) && map[f] === group && typeof mark === 'string' && mark.length <= 64) seen[f] = mark;
  }
  return seen;
}


// An admin's decision on a staged change that waits for approval on a
// live title (the Library's queues). The logic lives in
// lib/stagedChanges.js decideStaged (the admin show page decides single
// fields through the same function); this route keeps its request and
// answer shapes and decides every field of the part at once.
//
//   POST { type: 'episode' | 'series', id, decision: 'approve' | 'deny',
//          part?: 'art' (default) | 'video', note? }
//
// part 'art' (manage_artwork): the staged poster / still, the title image
// (or its removal) and the trailer — on an episode since migration 120 —
// and on a show its hero image too. Approving puts them live and logs the
// replaced files as orphaned; denying logs the staged files instead. A new
// trailer is switched to signed links at once (decision 12).
//
// part 'video' (review_submissions — a new master is new content): an
// episode's staged replacement video, `episodes.pending_src` (migration
// 118; amendment 9 of the series revamp). Approve is refused until
// Cloudflare says the new file is ready; then the new file plays, its
// runtime is the file's, a ready ad plan goes back to draft, and a title
// with captions is flagged "captions may be out of sync".
//
// Who is told: the uploader, and the show's owner (series.creator_id) when
// that's someone else — and for a show's own changes the owner — with the
// admin's note when there is one. The catalogue caches are cleared.
export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const part = body.part === 'video' ? 'video' : 'art';
  // Full admins pass; a sub-admin needs the capability the page that
  // calls this route is gated on (lib/adminAuth.js). A new video for a
  // live title is a review decision, not an artwork one.
  const roleContext = await requireCapability(req, res, part === 'video' ? 'review_submissions' : 'manage_artwork');
  if (!roleContext) return undefined;

  const { type, id, decision } = body;
  if (!['episode', 'series'].includes(type)) {
    return res.status(400).json({ error: 'type must be "episode" or "series".' });
  }
  if (!id || !isTitleId(String(id))) {
    return res.status(400).json({ error: 'id is required.' });
  }
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }
  if (part === 'video' && type !== 'episode') {
    return res.status(400).json({ error: 'Only an episode has a new video to decide on.' });
  }
  if (body.part !== undefined && !['art', 'video'].includes(body.part)) {
    return res.status(400).json({ error: 'part must be "art" or "video".' });
  }

  try {
    const waiting = await waitingFields(type, String(id), part);
    if (waiting === null) return res.status(404).json({ error: 'Not found.' });
    const seen = seenFields(type, body.seen, part);
    const fields = seen ? Object.keys(seen) : waiting;
    if (fields.length === 0 || waiting.length === 0) {
      return res.status(409).json({ error: part === 'video' ? 'There’s no new video waiting on this title.' : 'Nothing is waiting on this one any more. Reload the list.' });
    }
    const out = await decideStaged({ target: type, id: String(id), fields, decision, note: body.note, ...(seen ? { seen } : {}) }, roleContext);
    if (part === 'art') return res.status(200).json({ ok: true, type, id: String(id), decision, part: 'art' });
    return res.status(200).json({
      ok: true,
      type: 'episode',
      id: String(id),
      decision,
      part: 'video',
      runtime: out.runtime ?? null,
      adPlan: out.adPlan ?? null,
      captionsMayBeOutOfSync: Boolean(out.captionsMayBeOutOfSync),
      captionsFlagSaved: Boolean(out.captionsFlagSaved),
      notices: out.notices || []
    });
  } catch (err) {
    return showRouteError(res, err, 'admin/resolve-artwork', 'Could not resolve this change.');
  }
}
