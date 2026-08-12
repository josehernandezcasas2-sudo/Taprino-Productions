# Patch — caption uploads, audio description, accessibility panel

## Run these migrations

- `supabase/migrations/010_add_audio_description.sql`

(009 from the previous patch must already be applied.) Both are additive and
nullable — existing episodes are unaffected.

## New files

- `lib/captionUpload.js` — VTT validation, SRT→VTT conversion, storage
- `pages/api/creator/add-captions.js`
- `components/CaptionUploadModal.js`
- `components/AccessibilityPanel.js`
- `supabase/migrations/010_add_audio_description.sql`

## Modified

- `pages/creator.js` — "Add/Replace captions" button, "no captions" badge, modal
- `pages/api/creator/my-submissions.js` — returns caption state
- `pages/episode/[id].js` — accessibility panel, described-version switching
- `lib/episodes.js` — exposes the new fields
- `styles/globals.css` — appended

## Captions

Creators get a **💬 Add captions** button on every submission card. Approved
episodes without captions show a "no captions" badge, so the gap is visible
rather than something you have to remember to check.

**SRT files are converted automatically.** Browsers only understand WebVTT, but
SRT is what most editing software exports by default — rejecting it would fail
the most common file a creator actually has. Upload either.

Files are validated before they're stored: empty files, non-caption files, and
files with a header but no timed cues are each rejected with a specific reason.
A caption file that uploads cleanly and then displays nothing is a genuinely
confusing failure, so it's worth catching up front.

Captions apply **immediately**, unlike artwork, which is staged for review.
Artwork changes what the public sees on the homepage; a caption track only
appears for someone who has already turned captions on, and a wrong one is worth
fixing in seconds rather than in a review cycle. Replaced files go to the
existing orphan queue for cleanup.

They're stored in the `episode-art` bucket under a `captions/` prefix rather
than a new bucket — the orphan-tracking and admin cleanup path is already wired
to that bucket end to end, and a second one would mean replaced caption files
could never be cleaned up without rewiring it.

## Audio description

Implemented as a **separate video**, not a second audio stream on the same file.
Two reasons: HLS multi-audio-track switching is inconsistent across browsers,
and a described version is normally produced as its own export anyway, with
pauses extended to fit the narration. Netflix and the BBC do it the same way.

`audio_description_src` holds the playback URL. When present, viewers get a
"Play described version" toggle in the accessibility panel. For premium
episodes the described version is signed with **its own token** — a Cloudflare
token is scoped to one video, so reusing the main one would 403.

**There's no upload UI for this yet.** Set `audio_description_src` directly in
Supabase for now. Worth waiting until you have a described version to upload —
producing one is a real piece of work, not a checkbox.

## Accessibility panel

Sits under the video. Lists captions, audio description, and transcript, saying
plainly when each is *not* available — an honest "not available yet" is more
useful than silence, because it tells the viewer the feature exists at all.

Also surfaces a **flashing lights warning** when `has_flashing_lights` is set.
That one matters: a photosensitive viewer discovering strobing three minutes in
is exactly the harm the warning prevents. Set it per episode in Supabase.

`[CONTACT EMAIL]` in `AccessibilityPanel.js` needs filling in.

## Still open

- No creator UI for audio description, transcripts, or the flashing-lights flag
  — all three are database-only for now
- No formal colour contrast audit
- Cloudflare-hosted captions (`/stream/{uid}/captions/{lang}`) are read by the
  player but there's no upload path to them; this patch uses stored VTT files
