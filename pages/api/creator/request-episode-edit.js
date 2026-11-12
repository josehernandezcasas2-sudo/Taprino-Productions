import { startShowRoute, showViewer, showLimit, showRouteError } from '../../../lib/showRoute';
import { updateEpisode } from '../../../lib/showPage';
import { isTitleId } from '../../../lib/titleIds';
import { getSupabase } from '../../../lib/supabase';

// Your work's "Edit title & description" for a title of its own, as older
// app builds still send it (the website's components/RequestEditModal.js
// and the app's my-work screen use the show editor's own route since
// 2026-11-12).
//
//   POST { episodeId, title?, description?, pageNotes? }
//
// It is the show editor's save (lib/showPage.js updateEpisode), so the
// rules are the same everywhere (lib/showRules.js FIELD_POLICY, Jose
// 2026-11-12: "make sure descriptions and notes wait for review"): on a
// live title the title, the description and the page notes wait for an
// admin (pending_title, pending_description, pending_page_notes — the last
// needs migration 122: before it a live title's notes answer 503
// migration-122) and visitors see the live ones until then; on a title
// that has never been live (in review, "Not this time") they apply at once
// — this route used to stage them even on a title still in review. The
// uploader or the team (whose change applies at once).
//   → { ok, applied, staged, notices }; 400 when nothing changed.
export default async function handler(req, res) {
  if (!startShowRoute(req, res, ['POST'])) return undefined;
  try {
    const viewer = await showViewer(req, res);
    if (!viewer) return undefined;
    if (!(await showLimit(req, res, viewer, 'request-episode-edit', 60))) return undefined;
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const episodeId = raw.episodeId === undefined || raw.episodeId === null ? '' : String(raw.episodeId);
    const body = {};
    if (typeof raw.title === 'string' && raw.title.trim()) body.title = raw.title;
    // An empty description was never a change here (as before).
    if (typeof raw.description === 'string' && raw.description.trim()) body.description = raw.description;
    if (typeof raw.pageNotes === 'string') body.pageNotes = raw.pageNotes;
    if (!isTitleId(episodeId) || Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'episodeId and at least one of title/description are required.' });
    }
    // An older build sends the title and the description it was opened
    // with, changed or not: a field that still reads as the live one is
    // left out, so it never takes back a change already waiting (the old
    // route only ever staged what differed from the live text).
    const { data: live } = await getSupabase().from('episodes').select('title, description').eq('id', episodeId).maybeSingle();
    if (live) {
      if (body.title !== undefined && body.title.trim() === (live.title || '').trim()) delete body.title;
      if (body.description !== undefined && body.description.trim() === (live.description || '').trim()) delete body.description;
    }
    if (Object.keys(body).length === 0) return res.status(400).json({ error: 'Nothing actually changed from the current title/description.' });
    const result = await updateEpisode(episodeId, body, viewer);
    if (result.unchanged) return res.status(400).json({ error: 'Nothing actually changed from the current title/description.' });
    return res.status(200).json({ ok: true, applied: result.applied, staged: result.staged, notices: result.notices, notSaved: result.notSaved });
  } catch (err) {
    return showRouteError(res, err, 'creator/request-episode-edit', 'Could not submit your edit request.');
  }
}
