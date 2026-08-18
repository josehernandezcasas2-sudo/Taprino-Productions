# Patch — the last two open items from the Studio Tapa TV doc

Everything from that doc is now addressed. This patch covers the two that
were still open: library/footer edge-to-edge, and the green connection
dots on the edit-episode page.

## Library and footer — extended to the edges

**`.library-stage`** (genre, series, wishlist, type pages) — was capped at
1180px centered. Widened to the full viewport. Safe to do broadly here
since these are pure card-grid browsing pages with no paragraph text to
protect.

**The homepage, channel, and live pages** — added a new `.stage-wide`
modifier rather than touching `.stage` itself, since `.stage` is also
shared by every legal page (Terms, Privacy, etc.) and several admin tool
pages. Widening it directly would have stretched legal paragraphs and
admin forms uncomfortably wide — genuinely worse UX, not what was asked
for. `.stage-wide` is opt-in, applied only to the three pages that are
actually "library" content.

**The footer** was the interesting one — its border and background were
capped at 1180px too, so on a wide monitor it visually read as a floating
box rather than a true footer bar. Fixed with a CSS-only approach
(`padding: max(1.5rem, calc((100% - 1180px) / 2))`) rather than restructuring
markup — the same footer JSX is shared verbatim across 20 pages, and this
gets the same edge-to-edge result without needing to touch any of them.

**Left alone, deliberately:** `episode/[id].js` — it's a single-video watch
page, not really "the library" in the sense the doc meant. Say if you want
that widened too.

## Edit-episode: literal green dots

The earlier redesign already had color-coded banners and borders, but not
a literal small dot the way it was specifically asked for. Added one next
to each of **Poster**, **Thumbnail**, and **Attached ID** — green when
present, red when not. The video ID dot reflects the *live* Cloudflare
check already running in that modal, not just whether a string is saved,
so it goes amber-and-pulsing while checking, then green or red based on
what Cloudflare actually reports.

Screenshot attached — rendered and checked before shipping.

## Files changed
`styles/globals.css`, `pages/index.js`, `pages/channel.js`, `pages/live.js`,
`components/AdminEditEpisodeModal.js`
