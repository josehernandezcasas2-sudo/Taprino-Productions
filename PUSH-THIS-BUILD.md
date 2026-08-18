# Full build — replace your whole project folder

Confirmed by diff against your actual current local copy: your repo's
`main` branch is genuinely sitting at commit `c2b776e`, and everything
built since — the Studio Tapa TV rebrand, the logo-derived olive palette,
About/Contact pages, AdSense setup, the domain wiring for
studiotapatv.site, the WO-1/WO-2 cache-header fixes, and the homepage GSSP
parallelization — was never committed to this copy. Nothing was lost;
none of it ever landed here in the first place.

This zip is everything, verified compiling clean immediately before
packaging.

## Extract — Terminal only, no Finder

```bash
cd ~/path/to/taprino-ott
git status
```

If this shows anything unexpected (local edits you made that weren't from
one of my patches), stop and tell me before continuing.

```bash
cd .. && cp -r taprino-ott taprino-ott-backup-$(date +%Y%m%d-%H%M) && cd taprino-ott
unzip -o ~/Downloads/taprino-full-build.zip -d .
```

## Verify by content before committing anything

```bash
grep -c "name: 'Studio Tapa TV'" lib/siteConfig.js
grep -c "info@studiotapa.com" lib/siteConfig.js
grep -c "studiotapatv.site" lib/siteConfig.js public/robots.txt
grep -c "needsViewCounts" pages/index.js
ls pages/about.js pages/contact.js
grep -c "Taprino" pages/index.js
```

First four should print **1 or more**. The `ls` should print both paths
back. The last should print **0** — old branding fully gone.

## Push

```bash
npm install
git add .
git commit -m "Studio Tapa TV rebrand, domain wiring, AdSense pages, cache headers, GSSP optimization"
git push
```

## After Vercel finishes deploying

- Homepage — olive palette, "Studio Tapa TV" in header and footer, not
  "Taprino Transmission"
- `/about` and `/contact` — new pages, both load
- `/privacy` — shows `info@studiotapa.com` and `California, United
  States`, not bracketed placeholders
- `/admin` — amber warning naming exactly one remaining unfilled field:
  `mailingAddress`
- `/ads.txt` and `/sitemap.xml` — both load

## Your `.env.local` is untouched

It was correctly present in your zip and is never included in anything I
send back — real secrets stay local, always.

## Still needs you

- `mailingAddress` in `lib/siteConfig.js` — a PO box is fine
- Fix `CLOUDFLARE_STREAM_CUSTOMER_CODE` in Vercel to just the code, not
  the full subdomain
- The rest of `DOMAIN-SETUP.md`'s checklist — Clerk production mode,
  Stripe webhook, Resend sending domain
