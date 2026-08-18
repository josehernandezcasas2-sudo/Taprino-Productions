# Patch — hero, cards, mobile zoom, admin genre icons

Working through the Google Doc list item by item.

## 1 & 2. Hero: leftover text + full-bleed — already done

Checked both directly: `HeroSpotlight.js` has zero leftover "transmission"
text (the full rebrand already cleared it), and the hero genuinely sits
**outside** the constrained `.stage` container with its own `full-bleed`
CSS already active. Confirmed it stretches edge-to-edge with nothing
clipping it. Resolved by earlier work — no changes needed here.

## 3, 4, 5. Card badges and wishlist icon — fixed

Before: the tier badge ("Free with ads" / "Cipher Circle") and the
wishlist heart were both stacked on the right side, heart just below the
badge — not the left/right split that was asked for.

- **Tier badge → top-left**
- **Wishlist heart → top-right**, same height as the badge now
- **"Free with ads" background made solid**, not a translucent tint —
  reads clearly against any thumbnail now

**One correction I made while implementing this:** the free badge
previously used a `--cipher-teal` token, which in the current palette is
aliased to `--brass` — the color reserved for the *premium* Cipher Circle
tier everywhere else on the site. Using it for the *free* badge would have
made the two badges blend together by color association, working against
the entire point of the request. Used `--olive-deep` instead — the site's
primary brand tone, distinct from brass, contrast-checked at 5.16:1 (AA).

Applies to both card styles used across the site (`.ep-card` on the
homepage rows, `.poster-card` on genre/type/wishlist pages) — fixed once,
covers everywhere.

## 6. Mobile search zoom — fixed

Confirmed the cause directly: `.header-search-input` was set to `0.88rem`
(~14px). Any input under 16px triggers Safari's automatic zoom-on-focus on
iOS — well-documented browser behavior, not a bug in the code so much as a
missed threshold. Added a mobile-only override forcing 16px at that one
breakpoint, so desktop keeps its tighter look and mobile stops zooming.

## 7. Admin: upload custom genre icons — built

New: `/admin/genre-icons` — one card per genre, shows the current emoji or
uploaded image, upload/replace/reset-to-default per genre. Reuses the same
image upload path already used for episode posters, so it's consistent
with everything else in the admin panel rather than a new pattern.

Genres with nothing uploaded keep showing their default emoji automatically
— nothing changes on the live site until you actually upload something.

**Run migration `016_add_genre_icons.sql`** for this to work — creates the
`genre_icons` table.

Currently wired into `/type/[type]` pages, where `GenreBrowseRow` actually
renders. If you want genre icons showing elsewhere too, say where and I'll
wire that page the same way.

## Files changed
`components/GenreBrowseRow.js`, `pages/type/[type].js`, `pages/admin.js`,
`styles/globals.css`

## New
`lib/genreIcons.js`, `pages/api/admin/genre-icons.js`,
`pages/admin/genre-icons.js`, `supabase/migrations/016_add_genre_icons.sql`
