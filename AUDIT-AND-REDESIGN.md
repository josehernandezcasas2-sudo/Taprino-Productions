# Audit + olive redesign

## What I could and couldn't verify

I audited this **statically** — I can't click buttons in a live browser, so
I checked the things that are provable from the code: every `className`
used in JSX against every rule in the stylesheet, every state setter called
against where it's declared, every placeholder marker, and every hardcoded
colour. That catches real classes of bugs reliably. It does **not** catch
"this button fires but does the wrong thing," which still needs your eyes.

Items below marked **[NEEDS YOUR EYES]** are ones I flagged but couldn't
confirm without using the running site.

---

## FIXED — 8 components were rendering completely unstyled

Every one of these classes was referenced in JSX with **no CSS rule
anywhere**, so they fell back to browser defaults. Several are mine from
recent patches:

| Class | Where | Effect |
|---|---|---|
| `.b` | house-ads, applications | Status pills rendered as bare text |
| `.house-ad-info` | 3 admin pages | Card layout column had no constraints |
| `.acts` | admin/live | Button row didn't lay out |
| `.modal-panel` | CaptionUploadModal | **Whole modal shell unstyled** |
| `.modal-actions` | CaptionUploadModal | Buttons unstyled |
| `.back-link` | episode, wishlist | Plain browser link |
| `.genre-browse-row` | GenreBrowseRow | No spacing |
| `.hero-image` | Hero, SeriesHero | Missing object-fit — image could distort |

The caption modal one is worth noting: that whole feature looked broken
because its container had no styling at all.

## FIXED — the colour system is now actually a system

Before: **73 hardcoded hex values in CSS and ~30 more inline in JSX.** That
meant a retheme couldn't work by changing variables — roughly a third of
the site's colour was hand-written in place.

Now: 47 of those retired to tokens, plus all the inline JSX ones. The
remaining hardcoded values are deliberate (pure black for video letterbox,
white for text on coloured fills).

## The olive system

Every value contrast-checked against the surface it's actually used on:

| Token | Value | Purpose |
|---|---|---|
| `--surface-0` | `#15180f` | Page background |
| `--surface-1` | `#1d2117` | Header, footer, panels |
| `--surface-2` | `#262b1e` | Cards, inputs |
| `--surface-3` | `#313728` | Card hover |
| `--olive` | `#a3b55c` | **Primary accent** |
| `--olive-bright` | `#c2d47a` | Hover, emphasis |
| `--olive-deep` | `#5f6b34` | Borders, dim states |
| `--brass` | `#d9a441` | **Cipher Circle tier only** |
| `--ink` / `--ink-dim` / `--ink-faint` | | Text, 3 levels |
| `--ok` / `--warn` / `--danger` | | Status |

Contrast results: body text **14.8:1 (AAA)**, olive accent **8.0:1 (AAA)**,
all status colours clear AA. `--ink-faint` was specifically tuned up from
the original grey because it failed AA on raised cards — it passed on the
page background, which is exactly the kind of thing that slips through.

**Two deliberate decisions:**

1. **Surfaces carry an olive undertone** rather than the previous cold
   blue-grey. An olive accent on a blue-grey background reads as two
   unrelated palettes stacked; tinting the neutrals makes it one family.

2. **Brass is reserved exclusively for the premium tier.** I initially had
   `--warn` and `--brass` at the same value and caught it in the render —
   a "Processing" status pill and a "Cipher Circle" tier pill looked
   identical. Tier and status are different axes and must never be
   confusable, so `--warn` moved to `#e0863c`.

**Old token names still work.** `--signal-amber`, `--void`, `--cipher-teal`
etc. are aliased to the new system, so the ~2,000 existing references
re-theme automatically rather than needing a risky find-and-replace.

---

## STILL OPEN — needs your decision or your eyes

### 1. Legal placeholders are still unfilled — blocking
`[CONTACT EMAIL]` (5 places), `[MAILING ADDRESS]`, `[JURISDICTION]`,
`[REVENUE SHARE TERMS]` across `terms.js`, `privacy.js`, `cookies.js`, and
`AccessibilityPanel.js`. The revenue share clause in particular shouldn't
go live unfilled.

### 2. Header genre nav is a no-op on 12 pages **[NEEDS YOUR EYES]**
`onTypeSelect={() => {}}` is passed on every page except the homepage —
so selecting a genre from the header on `/apply`, `/live`, `/channel`,
`/account`, `/wishlist`, an episode page, etc. **does nothing at all.** No
error, no navigation, just silence.

The clean fix is routing to `/genre/[genre]` instead of calling a local
handler, so it works everywhere. I didn't do it in this pass because it
changes navigation behaviour across the whole site and I'd rather you
confirm that's what you want.

### 3. Not verifiable statically — worth a manual pass
- Whether every form actually submits successfully end-to-end
- Whether admin bulk actions behave correctly on real data
- Mobile layout at real breakpoints (I checked CSS, not rendering)
- Whether hero rotation cycles correctly with real content

---

## Files changed
`styles/globals.css` (palette + 8 missing rules), 12 JSX files
(inline colour tokens).
