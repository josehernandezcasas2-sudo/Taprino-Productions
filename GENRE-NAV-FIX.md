# Patch — genre navigation (and a correction to my earlier audit)

## First: I got the earlier finding wrong

In the audit I said the genre nav "does nothing on 12 pages" because of
`onTypeSelect={() => {}}`. That was wrong about the impact, and I should
have traced it before flagging it.

`onTypeSelect` was destructured in `HeaderNav` on line 7 and **never called
anywhere in the component**. The type links have always been real `<Link>`
navigation that works on every page. So the no-op prop was harmless dead
code, not a broken feature.

## The real gap underneath it

`HeaderNav` received `mainGenres` as a prop — from all 18 pages that render
it — and **never rendered them**. The browse dropdown offered types only.

So `/genre/[genre]` pages existed and worked, but were **unreachable from
the navigation on every page**, and browsing by genre was possible only on
the homepage via its own inline filter.

## What changed

- **Genre links added to the browse dropdown**, under a "Browse by genre"
  heading with a divider. Real `<Link href="/genre/...">` navigation, so it
  behaves identically from any page — no per-page handler needed.
- **`onTypeSelect` removed entirely** — from `HeaderNav` and all 15 call
  sites. Dead code either way.
- **`activeGenre` added** so the current genre highlights the same way the
  current type already does. `/genre/[genre]` passes its own genre through.
- One call site (`pages/genre/[genre].js`) had a *real* `onTypeSelect`
  handler rather than a no-op — but since the component never called it,
  it was dead too. Removed; the `<Link>` navigation supersedes it.

Verified: all 18 pages rendering `HeaderNav` already pass `mainGenres`, so
the genre section populates everywhere with no further wiring.

Multi-word genres round-trip correctly — `Science Fiction` →
`/genre/Science%20Fiction` → decoded back by the page's existing
`decodeURIComponent`.

## Files changed
`components/HeaderNav.js`, plus 15 pages (prop removal only).
