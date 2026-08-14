# AdSense readiness — what's done, and an honest assessment

## Done in this patch

| Requirement | Status |
|---|---|
| AdSense script in `<head>` | ✅ `pages/_document.js` |
| `ads.txt` with publisher ID | ✅ `public/ads.txt` |
| Privacy Policy naming AdSense + cookies explicitly | ✅ rewritten |
| **About page** | ✅ new — `/about` |
| **Contact page** | ✅ new — `/contact` |
| Terms of Service | ✅ existed |
| Cookie Policy | ✅ existed |
| Pages linked from every footer | ✅ 18 pages |
| HTTPS | ✅ via Vercel |
| Mobile-responsive | ✅ |
| `robots.txt` + sitemap | ✅ |

The privacy rewrite matters more than it looks. A generic "we show Google
ads" line is a **documented rejection reason** — Google requires specific
disclosure that third-party vendors use cookies, plus working opt-out links
to Google Ads Settings and aboutads.info. That exact language is now in
there.

## Honest assessment: you'll likely be rejected right now

Two blockers, neither of which is code:

### 1. You're on a `.vercel.app` subdomain
Google strongly prefers a real owned domain, and free subdomains are a
common rejection trigger. This is the same blocker already sitting in front
of Clerk production and Resend. **A `.com` is $10–15/year** — it's the
cheapest thing standing between you and three separate unblocked services.

### 2. Content volume
Consensus across current guidance is **15–30 substantial pieces** before
applying. You have roughly five episodes, two of which are still named
"test" and "Ashton's cut" with placeholder descriptions like "idk stuff
about the description of you."

Those placeholder titles are worth fixing regardless of AdSense — they're
publicly visible right now and undercut everything else the site is trying
to signal.

### What I'd actually suggest
Applying and getting rejected isn't free: repeated rejections extend the
cooling-off period between attempts. Better to apply once, properly, after
the domain is sorted and there's real content. Meanwhile the house-ads
system already works and needs nobody's approval.

## Still needs you: `lib/siteConfig.js`

Three values, used across About, Contact, Terms, Privacy, Cookies, and the
accessibility panel:

```js
contactEmail:    '[CONTACT EMAIL]',
mailingAddress:  '[MAILING ADDRESS]',
jurisdiction:    '[JURISDICTION]',
```

- **contactEmail** — a real monitored inbox. AdSense checks that it works.
- **mailingAddress** — required by AdSense and expected in a privacy
  policy. A PO box is completely fine; plenty of small studios do that
  rather than publish a home address.
- **jurisdiction** — which state's law governs the Terms. Presumably
  California, but it's a real legal choice.

Until these are filled, they render literally as `[CONTACT EMAIL]` on your
public pages. The admin dashboard now warns you which are outstanding.

## Also still open
`[REVENUE SHARE TERMS]` in `pages/terms.js` §5 — a clause to write, not a
value to substitute, and the one most worth a lawyer's eyes.
