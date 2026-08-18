# Patch — the actual image assets, plus Cipher Circle → Studio Tapa +

## The real bug behind "the studio transmission png still exists"

Every earlier rebrand pass was text/code-based — find-and-replace across
`.js` files. That could never touch this, because the old branding wasn't
in any code. Two static image assets had it baked directly into their
pixels/markup:

**`public/logo.svg`** — the hero's logo overlay. Had literal `<text>`
elements reading "TAPRINO" / "TRANSMISSION" inside the SVG markup itself.
Rewritten with "STUDIO TAPA" / "TV", using the actual current palette
colors (`#a3b55c` olive ring, `#d9a441` brass dot) instead of the old
teal/rust ones.

**`public/og-image.png`** — the social-share preview image (what shows up
when a link is pasted into Twitter, iMessage, Slack, etc.). I viewed the
actual file: full "TAPRINO TRANSMISSION" wordmark, old tagline, old
watermark — completely untouched, since it's a raster image no code
search could ever find. Rebuilt from scratch at the standard 1200×630 OG
size, styled with the current branding and olive palette.

Both verified visually before shipping — screenshots attached below.

## Cipher Circle → Studio Tapa +

39 replacements across 22 files. Centralized as `SITE.premiumTier` in
`lib/siteConfig.js`, the same pattern used for the platform name — so this
never needs a 22-file hunt again if the name changes further.

**A few spots needed more than a literal swap**, since "the Cipher Circle"
doesn't carry over grammatically to "the Studio Tapa +":
- "Join the Cipher Circle" → **"Join Studio Tapa +"** (dropped "the")
- "Encrypted for Cipher Circle members" → **"Available to Studio Tapa +
  members"** (the "Encrypted" heading was wordplay on "Cipher" specifically
  — doesn't make sense without that name, so I reworded rather than leave
  a heading that no longer means anything)

Verified: zero remaining mentions anywhere in the codebase (the only match
left is my own comment explaining the rename, in `siteConfig.js`), and the
full project compiles clean.

## Still open from the doc — not yet done

- **Full-bleed hero and library on every page, footer to the edges.**
  Confirmed the hero is already full-bleed on the homepage and
  `/type/[type]`. Haven't yet checked series, genre, channel, wishlist, or
  the footer specifically across all pages.
- **Edit-episode page polish + green dot indicators.** The video-status
  banner and media panel from an earlier patch already show clear
  attached/not-attached states with color coding — but not literally as a
  small green dot specifically, which is what was asked for. Worth a
  focused pass to add that exact treatment if the current version doesn't
  read clearly enough.

Want me to continue with those next?

## Files changed
`lib/siteConfig.js` + 21 files for the tier rename, `public/logo.svg`,
`public/og-image.png`
