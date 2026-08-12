# Patch — admin edit modal: styling + the actual "no film playing" cause

## What was actually wrong (two separate bugs)

**1. Likely why your film wasn't playing.** `pages/api/admin/library.js` never
selected the `src` column, so this modal had no way of knowing whether a
video was actually attached to any episode — it couldn't warn you, and the
UI gave no signal either way. Combined with an empty Cloudflare video ID
field (visible in your screenshot) and Status set to "Approved — live," an
episode can go fully live on the homepage with nothing behind it to stream.
Nothing in that flow was broken exactly — it did what it was told — but
there was no guardrail stopping this specific mistake, and no way to *see*
it had happened.

**2. The styling.** The modal's outer chrome (`.modal-card`, `.modal-header`)
was styled; every `label`/`input`/`select`/`textarea` inside the form had no
classes at all, so they rendered as raw browser defaults — the stark white
boxes in your screenshot.

## What changed

- `pages/api/admin/library.js` — now selects `src`, so the modal actually
  receives it
- `components/AdminEditEpisodeModal.js` — full rewrite:
  - **Checks the currently attached video against Cloudflare the instant
    the modal opens** — not just "is a URL saved," but "does Cloudflare
    actually consider this ready to stream." Shows one of: no video
    attached, ready, still processing, or Cloudflare-side error.
  - **Blocks approving an episode with no video attached**, with a real
    two-step confirmation (not a silent auto-proceed) — the exact
    combination that most likely produced the empty-player symptom you saw
  - Every field properly styled to match the rest of the admin
- `styles/globals.css` — appended

## About "checking that it's saving the video ID"

I read `pages/api/admin/edit-episode.js` in full — the save logic itself
was already correct: it validates the ID against Cloudflare before
accepting it, computes the real playback URL, and writes it to the
database. The gap wasn't the save path — it was that **nothing in the UI
ever told you whether it had actually been saved and was actually
watchable.** That's what this patch fixes: open the modal on any episode
now, and you'll see its real, live-checked status immediately, whether you
just edited it or not.

## What to do about "Ashton's cut" specifically

Open it in the new modal. If it shows the red "No video attached" banner,
that confirms the theory — paste in a real Cloudflare video ID (from
Cloudflare's dashboard, not a URL, just the ID) and hit Check before
saving, or set its status back to Pending until it has one.
