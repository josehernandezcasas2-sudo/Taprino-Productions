# Patch — show what's actually attached in the edit modal

## The problem

The "Replace poster / Replace thumbnail / Replace video" fields sat empty
regardless of whether anything was attached. An episode with a poster, a
thumbnail, and a working video looked identical to a blank one. That's the
same class of problem as the earlier "my video ID didn't save" confusion —
the data was there, the interface just never showed it.

## What it does now

**A "Current media" panel** above the replace fields, showing the actual
poster and thumbnail thumbnails, each labelled `In use` or `Not set`.
Empty slots get a dashed border and a literal "None" placeholder rather
than looking like a loading state.

**The attached video ID is shown, masked**: `c792************************`
— first four characters, rest starred. Four is enough to tell two videos
apart at this library's size while keeping the full string off screen by
default. A **Show full** toggle reveals it, since you genuinely need the
whole value to look a video up in Cloudflare's dashboard.

**Replacement is a deliberate act, not an accident:**
- Choosing a new image flips that slot amber, states the filename, and
  offers **Keep existing** to back out without closing the modal
- A soft warning appears explaining the current artwork is overwritten and
  not recoverable from here
- Entering a *different* video ID on an episode that already has one
  triggers a stronger warning, spelling out the real consequence: saved
  watch positions stop lining up, and if the new video is shorter, some
  viewers' progress will sit past its end

The file inputs themselves are now hidden behind styled labels
("Replace…" / "Upload…") — browser-default file inputs can't be styled
consistently, and "Choose File / No file chosen" communicated less than
naming the action does.

## Files changed
`components/AdminEditEpisodeModal.js`, `styles/globals.css`

No migration. No API change — `poster`, `thumbnail`, and `src` were already
being returned by `pages/api/admin/library.js` after the earlier fix.
