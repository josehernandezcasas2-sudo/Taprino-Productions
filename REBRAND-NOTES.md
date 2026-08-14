# Patch — Studio Tapa TV rebrand, contact details, logo-derived palette

## Contact details set

In `lib/siteConfig.js`:
- `contactEmail: 'info@studiotapa.com'`
- `jurisdiction: 'California, United States'`
- `contactGuidance` — the note asking people to put "Studio Tapa TV" in the
  subject line, since that inbox covers the whole studio. It appears on the
  contact page rather than being buried, so a viewer's billing question
  doesn't land unlabelled in the same pile as unrelated studio mail.

**Still needed: `mailingAddress`.** It's the only remaining placeholder, and
AdSense wants it. A PO box is completely fine.

## Renamed to Studio Tapa TV

The name was hardcoded in ~78 places across 28 files. It's now centralised
in `siteConfig` — renaming again is a one-line edit.

Set as `Studio Tapa TV` (matching the logo's spacing) with `STUDIO TAPA TV`
for the footer wordmark and `Tapa TV` for tight spaces. If you'd rather it
be `StudioTapa TV` with no space, that's one line in `siteConfig.js` now.

`Studio Tapa` remains the parent studio, kept deliberately distinct from
the platform name.

### One thing worth flagging about how this went

My first pass used a regex to rewrite the name inside quoted strings, and
it corrupted `className="..."` attributes across 28 files — turning
`className="site-footer">` into a malformed template literal. **The compile
check passed anyway**, because the damage happened to remain parseable.

I only caught it because I read the actual output rather than trusting the
green check. I reverted to the last packaged build and redid the whole
rename with literal string replacement only — no regex anywhere near JSX
attributes — then re-verified. The build in this zip is from that clean
second pass.

## Palette now derived from the logo

I sampled the logo artwork directly rather than eyeballing it. The circle is
**#595b36** — hue 63°. Rust #c85924, mint #93d0a4, blue #8499dc are its
accents.

Surfaces now use that same 63° hue at very low lightness, so the accent
reads as part of one family. The accent itself is the brand olive lifted in
lightness — **#595b36 as text on a dark background would fail contrast
outright**, so using the brand colour literally wasn't an option.

`--ok` and `--danger` were also retuned to the logo's mint and rust.

All values contrast-checked: body text 15.6:1 (AAA), accent 10.6:1 (AAA),
everything else clears AA.

`public/manifest.json` updated too — name, short name, and theme colour, so
the PWA install and browser chrome match.

## New: `DOMAIN-SETUP.md`

The list you asked for — every service needing the domain, in dependency
order, with the exact dashboard path for each. The one to read carefully is
Clerk: switching to production issues new keys and **signs everyone out
once**.

Supabase, Cloudflare Stream, and Upstash need nothing — nothing in the
codebase hardcodes a URL for any of them.

## On content volume

You're right that ~15 titles is roughly the bar. Worth pairing that with
fixing the two placeholder entries still live — "test" and "Ashton's cut",
with descriptions like "idk stuff about the description of you". Those are
publicly visible and would undercut an AdSense review on their own.
