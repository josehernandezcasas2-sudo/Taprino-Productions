// Browser-only and import-free: the one save for a title's "Allow
// downloads in the app" switch from Your work's edit boxes on the website
// (components/EditSubmissionModal.js; components/RequestEditModal.js
// sends it with its other fields through the same route). It is the show
// editor's own route, PATCH /api/show/episode/<id> { downloadsAllowed }
// (lib/showPage.js updateEpisode), which works for a standalone title —
// a film, a short — too and holds the rules (lib/downloadSiteRules.js
// downloadsAllowedChange): the uploader, the show's owner or the team; it
// applies at once in every state of the title; a podcast has no such
// switch (400); before migration 123 the route answers 503 "Downloads
// need a database update (migration 123)."
//   → { ok: true } or { ok: false, error }
export async function saveDownloadsAllowed(episodeId, allowed) {
  try {
    const res = await fetch(`/api/show/episode/${encodeURIComponent(String(episodeId))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadsAllowed: allowed === true })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data && data.error) || 'Could not save the downloads switch.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Couldn’t reach the site — check the connection and try again.' };
  }
}
