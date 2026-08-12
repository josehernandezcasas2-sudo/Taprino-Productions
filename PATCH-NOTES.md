# Patch — mobile tab bar + ad transparency

Drop these files into your repo, replacing the existing ones. Nothing here
touches the database, the API routes, or any environment variable.

## New file
- `components/MobileTabBar.js`

## Modified
- `styles/globals.css` — appended a `Mobile tab bar` block at the end. Nothing
  above it was changed, so if you'd rather review the diff, look only at the
  last ~60 lines.
- `pages/index.js`, `pages/account.js`, `pages/wishlist.js`,
  `pages/episode/[id].js`, `pages/series/[id].js`, `pages/genre/[genre].js`,
  `pages/type/[type].js` — one import line, one `<MobileTabBar />` before the
  closing fragment.
- `components/GenreRow.js`, `components/HeroSpotlight.js` — badge wording.

## What changed and why

**1. Bottom tab bar under 900px.**
Every route into the site currently sits behind a header dropdown, so on a
phone you open a menu to go anywhere. Five destinations now sit one thumb-tap
away: Home, Series, Films, My list, Account. All five point at routes that
already exist — no new pages. Above 900px it's hidden and the header nav is
untouched.

`body` gets `padding-bottom` at the same breakpoint so the footer and the last
card row clear the bar, and `.upload-status-widget` is nudged up so the upload
progress widget isn't hidden behind it.

**2. The free tier now says "Free with ads".**
It previously said "Free" everywhere. Naming the ad load up front is what keeps
a pre-roll from feeling like a bait-and-switch, and it's the honest frame for
the model you're actually running. Changed on the homepage rows, hero, series
episode list, genre grids, type pages, and wishlist.

## Check after deploying
- Load the site on a phone. The bar should sit above the home indicator on
  iPhone, not under it (that's the `env(safe-area-inset-bottom)` padding).
- Scroll to the footer — it should be fully readable, not clipped.
- Start an upload from the creator page and confirm the progress widget sits
  above the bar.
- Resize a desktop browser past 900px and confirm the bar disappears.

## Not done yet
The funding module, the ad markers on the scrub bar, and the admin triage panel
from the mockups are all still open. The funding work needs a schema migration
and is the bigger piece — worth doing on its own.
