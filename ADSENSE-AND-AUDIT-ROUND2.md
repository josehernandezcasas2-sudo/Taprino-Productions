# Patch — AdSense + audit backlog

## AdSense

**Script added to `pages/_document.js`**, not `_app.js` — deliberately. It
needs to be in the server-rendered HTML on the first request, because
AdSense's reviewer checks for the tag when assessing the site, and a script
React injects later can be missed. This is the *display* ads script; it
doesn't interact with the IMA SDK in `_app.js` that runs your in-player
video ads.

**`public/ads.txt` created — this one is required, not optional.** AdSense
looks for it at `yourdomain.com/ads.txt`, and without it some exchanges
won't bid on your inventory at all because they can't verify you're
authorised to sell it. It contains your publisher ID, which must stay in
sync with the script tag if you ever switch AdSense accounts.

**Worth being straight about:** AdSense reviews usually want a real custom
domain, meaningful content, and complete legal pages. Two of those three
are still outstanding — see below.

## Audit items closed this round

**`robots.txt`** — admin, creator tooling, API routes, and the account page
excluded from crawling. Contains a sitemap line you'll need to update when
the real domain lands.

**`/sitemap.xml`** — generated at request time from live data rather than a
static file, so newly published episodes appear without anyone regenerating
anything. Covers static pages, genres, series, and episodes. Fails soft: if
data fetching errors, it returns a sparse sitemap rather than a 500, because
crawlers back off from sites that error.

**Custom `404` and `500` pages** — the default Next 404 was an unstyled white
page with a system font and no way back into the site. Both new pages are
deliberately dependency-free: no header, no data fetching, nothing that
could itself fail and turn a 404 into a 500.

**Legal placeholders centralised into `lib/siteConfig.js`.** They were
spread across 17 spots in four files, so filling them in meant finding every
one. Now it's one file, three values. The admin dashboard shows a warning
listing exactly which fields are still unfilled — visible rather than
forgotten, but not blocking, since you may well want to deploy and test with
placeholders in.

## Still outstanding — needs you, not code

**1. Fill in `lib/siteConfig.js`** — `contactEmail`, `mailingAddress`,
`jurisdiction`. These appear literally as `[CONTACT EMAIL]` on your public
legal pages until you do, and AdSense reads those pages during review.

**2. `[REVENUE SHARE TERMS]` in `pages/terms.js` §5** — deliberately NOT
centralised, because it isn't a value to substitute, it's a clause someone
needs to write. It's also the one I'd most want a lawyer to read, since it
determines what you can legally pay creators.

**3. Custom domain** — still gating Clerk production, Resend production, and
realistically AdSense approval too.

## Files changed
`pages/_document.js`, `pages/admin.js`, `pages/terms.js`, `pages/privacy.js`,
`pages/cookies.js`, `components/AccessibilityPanel.js`, `styles/globals.css`

**New:** `lib/siteConfig.js`, `pages/404.js`, `pages/500.js`,
`pages/sitemap.xml.js`, `public/ads.txt`, `public/robots.txt`
