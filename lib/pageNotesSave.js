// Browser-only and import-free: the one save for a title's page notes from
// Your work's edit boxes on the website (components/EditSubmissionModal.js;
// components/RequestEditModal.js sends them with the title and description
// through the same route; the app's my-work screen does the same through
// its own request helper). It is the show editor's own route,
// PATCH /api/show/episode/<id> { pageNotes } (lib/showPage.js
// updateEpisode), which works for a standalone title too and holds the
// rules: the uploader (or the team) may change them; on a live title they
// wait for approval (pending_page_notes, migration 122 — Jose, 2026-11-12:
// "make sure descriptions and notes wait for review"; before 122 that
// answers 503 "Notes need a database update (migration 122).") and on a
// title in review, pulled or a draft they apply at once; locked once its
// removal is requested or it was withdrawn; 4,000 characters. Before
// migration 118 the route saves nothing and says so in `notSaved`.
//   → { ok: true, staged } (staged = they wait for approval) or { ok: false, error }
export async function savePageNotes(episodeId, notes) {
  try {
    const res = await fetch(`/api/show/episode/${encodeURIComponent(String(episodeId))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNotes: typeof notes === 'string' ? notes.trim() : '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data && data.error) || 'Could not save the notes.' };
    const notSaved = data && Array.isArray(data.notSaved) ? data.notSaved.find((n) => n && n.field === 'pageNotes') : null;
    if (notSaved) return { ok: false, error: notSaved.reason || 'Needs a database update (migration 118).' };
    return { ok: true, staged: Array.isArray(data.staged) && data.staged.includes('pageNotes') };
  } catch (err) {
    return { ok: false, error: 'Couldn’t reach the site — check the connection and try again.' };
  }
}
