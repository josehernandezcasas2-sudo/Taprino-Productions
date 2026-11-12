# The local test rig

Runs the web app (`next dev` on **:3100**) against a real Postgres 16 built
from the checkout's own migrations, PostgREST 12.2 in front of it, and
stand-ins for Supabase Storage, Clerk, Stripe and Cloudflare Stream. Nothing
it starts talks to a live service, and every key in it is fake.

It lives in the repo so a reset of the cloud container can't lose it. What it
writes at run time (the database cluster, keys, stored files, logs, pid files)
goes under `RIG_DATA_DIR` (default `${TMPDIR:-/tmp}/studio-tapa-rig`), outside
the repo.

## Start, stop, reset

```bash
dev/test-rig/fetch-postgrest.sh          # once per machine: the PostgREST binary (outside the repo)
dev/test-rig/start.sh                    # this checkout
dev/test-rig/start.sh /path/to/checkout  # another checkout (a branch's worktree)
dev/test-rig/status.sh
dev/test-rig/reset.sh                    # back to the seed (truncate + reseed, fakes reset)
dev/test-rig/reset.sh --rebuild          # drop the database, run the chain again, reseed
dev/test-rig/stop.sh                     # everything down; the data stays
node dev/test-rig/smoke.mjs              # the smoke check (rig must be up)
```

`start.sh` initialises the cluster if there is none, builds the database from
the checkout's `supabase/schema.sql` + every `supabase/migrations/NNN_*.sql` if
it is empty (then snapshots the data the chain itself writes, for `reset.sh`,
and seeds), applies any migration the checkout has that the database lacks,
starts PostgREST and the four stand-ins, and starts `next dev -p 3100` in the
checkout. A second `start.sh` while things run only starts what is down.

The checkout needs its `node_modules` (a worktree can symlink them:
`ln -s /path/to/main/checkout/node_modules node_modules`). Next writes its
`.next/` cache there, as `npm run dev` would.

| Variable | Effect |
| --- | --- |
| `RIG_MIGRATE_TO=117` | Build the database only up to migration 117 (to see "before 118" behaviour). Changing it rebuilds the database. The seed leaves out columns and tables that don't exist yet and says which. |
| `RIG_REBUILD=1` | Drop and rebuild the database on this start. |
| `RIG_SEED=1` | Upsert the seed again on this start (it runs by itself only on a fresh build and on reset). |
| `RIG_DATA_DIR`, `RIG_CACHE_DIR` | Where the run-time data and the PostgREST download live. |
| `RIG_PG_BIN`, `RIG_PSQL`, `RIG_POSTGREST_BIN` | Other Postgres / PostgREST binaries. |
| `RIG_NEXT_PORT`, `RIG_PG_PORT` | Other ports for Next (3100) and Postgres (54329). |
| `RIG_APP_ENV_<NAME>=value` | Give the app one variable a different value (e.g. `RIG_APP_ENV_PRIVATE_BETA=on`). |
| `RIG_CF_AUTOREADY_SECONDS=5` | Uploaded videos become ready by themselves after N seconds (default: only through `/__ready`). |
| `RIG_STRIPE_API_EVENTS=0` | The fake Stripe stops sending the webhooks Stripe sends after API calls (refund → `charge.refunded`, …). |
| `RIG_SUPABASE_TLS=0` | Give the app the plain-http Supabase address (images through next/image then fail; see below). |

## Ports

| Port | What |
| --- | --- |
| 3100 | `next dev` (the app) |
| 54321 | Supabase stand-in, http: `/rest/v1/*` → PostgREST, `/storage/v1/*` → Storage stand-in |
| 54331 | the same stand-in over https — **the address the app is given** (see "Why https") |
| 54322 | fake Stripe |
| 54323 | fake Clerk |
| 54324 | fake Cloudflare Stream (API and delivery host) |
| 54325 / 54326 | PostgREST / its admin port (`/ready`) |
| 54329 | Postgres (`psql -h 127.0.0.1 -p 54329 -U postgres`, trust auth) |

## Accounts

The fake Clerk serves these (from `seed/accounts.json`); the seed writes the
matching `user_profiles`. Ids have Clerk's real shape — `user_` and letters
or digits only — because the app checks it (`looksLikeUserId`): an id with a
second underscore is refused as a member on the invoice webhook and read as a
handle on `/profile/<id>`.

| Id | Alias | Who |
| --- | --- | --- |
| `user_rigAdmin` | `admin` | full admin, two-step on, `admin@rig.example.com`, handle `studioadmin` |
| `user_rigMara` | `mara` | creator "Mara Reyes", handle `mara`, payout account `acct_rigMara` ready |
| `user_rigDee` | `dee` | creator "Dee Park", handle `dee` |
| `user_rigViewer` | `viewer` | a signed-in viewer, handle `vic` |
| `user_rigSub` | `sub` | sub-admin with `review_submissions` + `manage_episodes`, two-step on |

Every address is verified and on example.com. `mint-session.mjs` and the fake
Clerk's hooks also accept `user_rig_mara`, a handle, a username or a first name.

## Signing in

```bash
node dev/test-rig/mint-session.mjs mara            # Cookie header value
node dev/test-rig/mint-session.mjs mara --token    # the JWT, for Authorization: Bearer (the app's calls)
node dev/test-rig/mint-session.mjs mara --json     # { cookie, token, expiresAt, cookies[] } for Playwright
node dev/test-rig/mint-session.mjs --signed-out    # the dev-browser cookie alone
curl -H "Cookie: $(node dev/test-rig/mint-session.mjs mara)" http://127.0.0.1:3100/api/my-role
```

The token is RS256, kid `rig-test`, signed with the key the fake Clerk serves at
`/v1/jwks` (that is how `@clerk/nextjs` 6.39 verifies it: it fetches the JWKS
from `CLERK_API_URL`; it doesn't read `CLERK_JWT_KEY`, which the rig sets anyway).
It lasts an hour (`--minutes=N`). The cookie also carries:

- `__client_uat=1700000000` — before the token's `iat`, or Clerk asks for a handshake;
- `__clerk_db_jwt=…` — the publishable key is a development one (`pk_test_…`), and a
  development instance sends **any** browser page request without a dev-browser
  cookie to Clerk's handshake page (a 307 to `clerk.example.com`). Send it signed
  out too (`--signed-out`); `curl` without `Accept: text/html` isn't affected.

In Playwright: `context.addCookies(json.cookies.map((c) => ({ ...c, url: 'http://127.0.0.1:3100' })))`.

## The seed

Text slug ids like the real ones (`seed/catalogue.mjs` `IDS`), real columns,
and the real constraints accept it:

| Id | What |
| --- | --- |
| `the-long-quiet-lx3k9a` | Mara's film, approved, free, with a trailer, its own page on, Tapa Original |
| `kitchen-hours-m1q8zt` | Dee's short, approved, premium |
| `night-bus-lx3k9a` | Mara's series, public (approved + `public_at`), seasons "The Late Line" / "New Routes"; for sale ($9.99) |
| `night-bus-first-stop-lx3k9b`, `…-the-transfer-lx3k9c`, `…-last-stop-lx3k9d` | S1 E1 (free), E2 (premium, own page + notes), E3 (premium, $1.99) |
| `night-bus-new-route-lx3k9e` | S2 E1 |
| `night-bus-making-of-lx3k9f` | extra filed with the show (`bonus_parent_type` series) |
| `night-bus-deleted-scene-lx3k9g` | extra after S1 E3 (`bonus_parent_type` episode) |
| `harbor-lights-p7w2qa` / `harbor-lights-pilot-p7w2qb` | Mara's private show (pending) with one approved episode — "Ready to go public" |
| `line-cooks-d4r8vn` / `line-cooks-opening-shift-d4r8vp` | Dee's private show with its episode in review |
| `tapa-talk-c2x9mm` / `tapa-talk-pilot-c2x9mn`, `tapa-talk-on-funding-c2x9mp` | Dee's public podcast with two episodes |

Every title's `src` is `https://customer-test.cloudflarestream.com/<uid>/manifest/video.m3u8`
(the shape the app stores), with a video of that uid preloaded in the fake
Cloudflare, ready and demanding signed links. Posters, stills and heroes are
drawn pictures in the public `episode-art` bucket. The chain's own rows
(`site_settings` row 1, the ratings, the first channel…) are kept as the chain
writes them.

## Why https (54331)

`next.config.js` only lets `next/image` load Supabase pictures over **https**
(`remotePatterns` `protocol: 'https'`), and in development `next/image` throws
on any other address — a page with a poster at `http://127.0.0.1:54321/…`
renders as a 500. So the stand-in also listens on https :54331 with a
certificate from a CA the rig makes (`$RIG_DATA_DIR/keys/rig-ca.pem`), the app
gets `SUPABASE_URL=https://127.0.0.1:54331`, and Node trusts that CA through
`NODE_EXTRA_CA_CERTS` (nothing turns verification off). Plain http :54321
stays for `curl` and tools. A browser that loads a Storage address directly
(a few `<img>` tags) needs the CA, or Chromium's
`--ignore-certificate-errors-spki-list=<spki>` (what `smoke.mjs` does; the key
hash is `loadKeys().tls.spki` in `lib/keys.mjs`).

## The app's environment

Every variable the app's code reads is set explicitly — to a rig address or
fake key, or blank — and `__NEXT_PROCESSED_ENV=true` tells `@next/env` the
environment is already loaded, so a checkout's `.env.local` / `.env` is never
applied (Next still lists it under "Environments" in its log). The names are
collected from the checkout's `lib/`, `pages/`, `components/`, `contexts/`,
`middleware.js` and `next.config.js` at start, so a branch that reads a new
variable gets it blanked. `node dev/test-rig/bin/rig.mjs env` prints the lot.
Edits to a `.env.local` while `next dev` runs make Next reload the env files;
restart the rig after one.

Set: `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` (https :54331),
`SUPABASE_SERVICE_ROLE_KEY` (HS256 `{ role: service_role }` minted from
PostgREST's secret), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY=sk_test_rig`
+ `STRIPE_API_HOST/PORT/PROTOCOL`, `STRIPE_WEBHOOK_SECRET=whsec_rig`,
`STRIPE_CONNECT_WEBHOOK_SECRET=whsec_rig_connect`, `CLERK_API_URL`,
`CLERK_SECRET_KEY=sk_test_rig`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`,
`CLERK_JWT_KEY`, Clerk telemetry and keyless off, `CLOUDFLARE_ACCOUNT_ID` /
`_API_TOKEN` / `_STREAM_CUSTOMER_CODE=test` / `_API_BASE` / `_STREAM_ORIGIN`,
`CRON_SECRET=rig-cron-secret`, `ADMIN_NOTIFY_SECRET=rig-admin-notify-secret`,
`EXPO_PUSH_URL` (the fake Clerk's sink), `PAYEE_RULE_FROM=2026-10-15T00:00:00.000Z`,
`WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` (a VAPID pair the rig makes on
first start, `$RIG_DATA_DIR/keys/vapid.json`), `WEB_PUSH_SUBJECT=mailto:rig@rig.example.com`,
`WEB_PUSH_TEST_ORIGIN` (the fake Clerk, the one extra push service the app
accepts outside production; `lib/webPush.js` ignores it in production),
`NEXT_TELEMETRY_DISABLED=1`. Blank: Upstash (rate limits fall back to the
per-process counter, caches to direct reads), Resend (no email is sent), Brevo,
Notion, Bunny, `PRIVATE_BETA`, `CLOUDFLARE_STREAM_KEY_ID/_PEM`, the rest.

## The stand-ins

All keep their state in memory (Storage on disk), answer `GET /__health`,
and all but Supabase take `GET /__state` and `POST /__reset`. Request logs:
`$RIG_DATA_DIR/logs/<name>.requests.log`.

### Supabase (:54321 http, :54331 https)

- `/rest/v1/*` → PostgREST 12.2.12 (prefix stripped, headers passed). The
  database has Supabase's API roles (`anon`, `authenticated`, `service_role`
  with BYPASSRLS, `authenticator`), its default grants (migration 112 then
  takes them from anon/authenticated, as in production — the anon key gets
  `permission denied`), pgcrypto and uuid-ossp in `extensions`, and
  `db-max-rows = 1000` like Supabase's API. PostgREST listens for
  `notify pgrst, 'reload schema'`; the chain sends it.
- `/storage/v1/*`: buckets (list, get, create, update, empty, delete), objects
  (upload/update with upsert, raw or multipart; download; remove; list; move;
  copy; info), `createSignedUrl(s)` (with `download`), `createSignedUploadUrl`
  + the upload to it, public addresses (`/object/public/…`, a private bucket
  refuses them), size limits (413) and allowed MIME types (415). Writes need
  the service-role key. Files under `$RIG_DATA_DIR/storage`.
- Not covered: image transforms (`render/image` serves the original), RLS
  policies on storage, resumable (tus) Storage uploads, auth (`/auth/v1`).

### Clerk (:54323)

Backend API under `/v1` (the secret key `sk_test_rig` required): `jwks`,
`users` list (`user_id`, `email_address`, `username`, `external_id`, `query`,
`limit`, `offset`, `order_by`) and `count`, get / create / update / delete a
user, `PATCH /users/:id/metadata` (deep merge, `null` removes a key),
`invitations` list (`status`, `query`, paginated) / create (refuses an address
with an account or a pending invite unless `ignore_existing`) / revoke.
Clerk's 404/422 error shape.

Hooks: `POST /__users/<id>` with `{ role, permissions, twoFactorEnabled,
publicMetadata, privateMetadata, banned, emailVerified, createdDaysAgo,
firstName, lastName }`; `POST /__roles?user=mara&role=sub_admin&permissions=a,b`;
`POST /__twofactor?user=admin&on=0`; `POST /__users` (a new account);
`GET /__session?user=mara` (a cookie, like `mint-session.mjs`);
`POST /__expo/push/send` (the push sink; `GET /__state` lists what arrived);
`POST /__webpush/<token>` (the web push sink, 2026-11-12: answers 201, or 410
for a token starting `gone`, 404 for `missing`, 500 for `fail`; records the
TTL, Urgency, Content-Encoding, the VAPID token's claims and whether its
signature checks out against the key it names, and — once a check has sent
`POST /__webpush-keys { token, privateKey, auth }` for a stand-in browser
made by `lib/webpush.mjs` `makeBrowser` — the message decrypted, as
`webPushes` in `GET /__state`);
`POST /__fail?user=<id>&on=1|0` (that account's reads — `GET /v1/users/<id>`
and a users list asking for it by `user_id` — answer 500; `user=*&on=0`
clears them all).

Not covered: Clerk's frontend. The browser loads `clerk-js` from
`clerk.example.com`, which doesn't exist, so in a browser Clerk's client hooks
never load: signed-in pages render from server props (the header, the pages'
own data), but the sign-in modal, `useUser()` and Clerk's account UI don't work.
No sessions/clients/organizations API, no handshake endpoint.

### Stripe (:54322)

`/v1` with `sk_test_rig`, form-encoded like the real API, Stripe-shaped
objects, lists (`limit`, `starting_after`, `ending_before`), `expand`
(including `data.*` and a customer's `subscriptions`), idempotency keys,
`Stripe-Account` for a connected account's balance and payouts, and Stripe's
error shape (404 `resource_missing` for unknown ids and for any endpoint it
doesn't implement). Seeded: products/prices for Standard $7.99, Premium $12.99,
Sponsor $6.99 (metadata `tier`), the platform account `acct_rigPlatform`
(payout schedule `manual`, $500 available) and Mara's ready Express account
`acct_rigMara`.

Covered: products, prices (with `tax_code` / `tax_behavior` updates), customers (create/retrieve/update/delete/list by
email/search on `metadata['k']:'v'` and `email:'v'`), checkout sessions
(create — payment, subscription, setup; destination charges with
`application_fee_amount` or `transfer_data.amount`; retrieve; list; expire;
line items), billing portal sessions, accounts (create/retrieve/update/list,
`GET /v1/account` = the platform), account links, login links,
subscriptions (list/retrieve/update/cancel), balance, balance transactions
(list with `created`, `type`, `source`, `payout`), payouts (list/create/
retrieve/cancel), transfers (create — refuses more than the available balance
without `source_transaction` — retrieve, list, reversals), refunds (with
`reverse_transfer`), payment intents, charges, invoices (retrieve), events
(list — newest first, `type` exact or `invoice.*`, `types[]`, `created` —
and retrieve; a connected account's events only with its `Stripe-Account`
header, as Stripe does), disputes (retrieve), webhook endpoints (one, every
event).

Pages: `/checkout/<id>` (Pay / Cancel — Pay completes the session, sends the
webhooks and lands on the `success_url`), `/portal/<id>` (cancel at period end),
`/connect/onboard/<acct>` (Finish onboarding → the account is ready and
`account.updated` goes out), `/connect/dashboard/<acct>`.

Webhooks go to `http://127.0.0.1:3100/api/webhook`, signed with `whsec_rig`
(Connect events, which carry `account`, with `whsec_rig_connect`). Completing
a payment session sends `checkout.session.completed`; a subscription session
also creates the subscription and a paid invoice and sends
`customer.subscription.created` and `invoice.paid`. After API calls, as Stripe
does: refund → `charge.refunded`, reversal → `transfer.reversed`, expire →
`checkout.session.expired`, subscription update/cancel →
`customer.subscription.updated/deleted`, account update → `account.updated`.

Hooks: `POST /__checkout/<id>/complete` and `/__checkout/<id>/expire` (answer
the session and each delivery's status and body), `POST /__accounts/<id>/ready`,
`POST /__payouts/<id>/paid|failed`, `POST /__dispute` `{ charge, phase:
created|won|lost }`, `POST /__event` `{ type, object | objectId, account?,
previous?, ageMinutes?, deliver? }` (any event, signed and delivered;
`deliver: false` only records it in the events list — a delivery Stripe
never got through — and `ageMinutes` dates it back),
`POST /__subscriptions/<id>/renew` `{ deliver?, ageMinutes? }` (a paid
renewal invoice, `billing_reason: subscription_cycle`, with its charge and
`invoice.paid`; the same two options — this is how the app's daily Stripe
catch-up is exercised: a renewal never delivered, an hour or more old, is
found in the events list and recorded), `POST /__events/forget` `{ ids? |
invoices? | all? }` (events leave the events list: a check that deletes the
rows an invoice made should forget its events too, or the daily catch-up —
`/api/cron/creator-reminders`, which `payee-invites.mjs` runs — records that
invoice again once its event is an hour old), `GET /__state` (objects,
balances, deliveries), `GET|POST /__tax` (Stripe Tax, below).

**Stripe Tax** (sales tax on memberships, backings and bookings, migration
122). A Checkout session with `automatic_tax[enabled]=true` works the tax
out per line: the line's tax code (`price_data.product_data.tax_code`, else
the catalog product's `tax_code`, else the account default) picks a rate
(the hook's `codeRates`, else `rate`), and its tax behaviour (`price_data`'s
or the catalog price's `tax_behavior`, else the account default) says on top
(`exclusive`: `amount_total` = subtotal + tax) or inside (`inclusive`). The
session has `total_details.amount_tax` and `automatic_tax.status: complete`,
each line `amount_tax`; a subscription session's first invoice has `tax` +
`total_tax_amounts` (the events' API version, 2024-06-20) or, with
`invoiceShape: 'basil'`, `total_taxes`, and `amount_paid` includes the tax;
the subscription carries `automatic_tax.enabled`; `customer_update[address]
=auto` saves a California address on the customer. Refused with a 400 like
the real API when Stripe Tax isn't active (`active: false`), when a line has
no tax behaviour and there's no default (the seeded membership prices are
`unspecified`, as Jose's are until the settings card's button runs — so a
membership Checkout with tax is refused and the site makes it again without),
when a customer has no address and `customer_update[address]` isn't `auto`,
when `customer_update` comes without `customer`, and whenever `refuse` is
set. `POST /v1/products/<id>` takes `tax_code` (txcd_ + 8 digits);
`POST /v1/prices/<id>` takes `tax_behavior` once, from `unspecified`
(changing it after is refused, as Stripe does), plus `active`, `metadata`,
`nickname`, `lookup_key`. `GET /v1/tax/settings` (`status` active/pending,
`defaults`) and `GET /v1/tax/registrations` (from the hook's list).
`transfer_data.amount` fixes the connected account's transfer, and a refund
with `reverse_transfer` reverses it in proportion to the refund over the
whole charge, tax included.

`GET /__tax` answers the state; `POST /__tax` merges `{ rate?, codeRates?,
refuse?, active?, defaultBehavior?, defaultCode?, registrations?,
invoiceShape? }`: `rate` in percent (`8.25`), `codeRates` per code
(`{ "txcd_20030000": 8.25 }`), `refuse` a message every automatic-tax
Checkout is refused with (`null` to stop), `registrations` like `["CA"]`.
Defaults (and after `/__reset`): rate 0 — no registration, every tax $0,
the studio today — `codeRates { txcd_90000001: 0, txcd_00000000: 0 }` (a
backing is a cash donation; Nontaxable), active, no default behaviour or
code, no registrations.

```bash
curl -s -XPOST localhost:54322/__tax -H 'content-type: application/json' -d '{"rate":8.25,"registrations":["CA"]}'
curl -s -XPOST localhost:54322/__tax -H 'content-type: application/json' -d '{"refuse":"Stripe Tax is not set up."}'
```

Not covered: coupons and promotion codes,
invoices beyond the first, renewals, payment methods, setup intents, 3-D
Secure, the v2 API, real fee maths beyond 2.9% + 30¢, application fees as
objects, test clocks.

### Cloudflare Stream (:54324)

`CLOUDFLARE_API_BASE=http://127.0.0.1:54324/client/v4`, the token
`rig-cloudflare-token`. `POST /accounts/<a>/stream?direct_user=true` (tus
creation: `Upload-Length`, `Upload-Metadata` with `name`, `requiresignedurls`,
`maxdurationseconds`, `expiry`, and `Upload-Creator` → 201 + `Location:
/tus/<uid>`), the tus endpoint itself (OPTIONS, POST, HEAD, PATCH with offsets,
CORS for the browser), `direct_upload` + `POST /upload/<uid>`, `GET/POST/DELETE
/stream/<uid>` (status, `requireSignedURLs`, meta), `POST /stream/<uid>/token`,
`POST /stream/copy`, `GET /stream`, downloads (default and audio, ready at
once), live inputs (create/get/delete). A finished upload is `inprogress`
until `/__ready` (or `RIG_CF_AUTOREADY_SECONDS`).

Delivery (`CLOUDFLARE_STREAM_ORIGIN=http://127.0.0.1:54324`):
`/<uid or token>/thumbnails/thumbnail.jpg` (a drawn JPEG frame),
`/manifest/video.m3u8` (a playlist), `/iframe`; a protected video answers 401
unless the path carries one of this fake's tokens.

Hooks: `POST /__ready?uid=…[&duration=]`, `POST /__fail?uid=…[&code=]`,
`POST /__autoready?seconds=N`, `POST /__video` `{ uid?, name, creator,
duration, ready, requireSignedURLs }`, `GET /__state`.

Not covered: real video. The addresses the app hands a browser are
`https://customer-test.cloudflarestream.com/…`, which don't exist, so nothing
plays in a browser; the manifest the fake serves has no segments. No
watermarks, captions, clipping or webhooks.

## The smoke check

`node dev/test-rig/smoke.mjs [--http-only|--browser-only]`: the main pages
and their JSON routes signed out, as Mara and as the admin (status per page,
redirect targets; fails on any 5xx), then Chromium at 390 and 1280 on a
handful of pages, reporting page errors (these fail it), console errors,
5xx or failed loads from the rig's own hosts, and horizontal overflow, with
every request to a host other than the rig aborted. The report
is written to `$RIG_DATA_DIR/state/smoke.json`.

## The checks

`dev/test-rig/checks/` holds re-runnable checks of one area each (films on
the own-page landing, kinds of extras before and after 121, captions and
the podcast preview as the app calls them, the moderation cleanup, money
through the fakes, stuck payee invites, the money edge cases, web push,
podcast audio and the crawler refusal, notes and descriptions waiting for
review, season art, sales tax, the flashing-lights card, the round's
small fixes); see `checks/README.md`.

## Things in the app that reach outside the rig

- `lib/stripeStatus.js` calls `https://api.stripe.com/v2/core/event_destinations`
  directly (it ignores `STRIPE_API_HOST`), on `/admin/pitch-room`; it falls back
  to the v1 webhook list when that fails.
- `lib/geocode.js` asks OpenStreetMap's Nominatim for places (Locations, Crew
  Call searches by place).
- In the browser: Google Fonts, Google's IMA / AdSense scripts, Clerk's
  frontend (`clerk.example.com`), Cloudflare Stream addresses.

## Files

```
dev/test-rig/
  start.sh stop.sh reset.sh status.sh fetch-postgrest.sh
  mint-session.mjs smoke.mjs
  checks/              re-runnable checks, one area each (checks/README.md)
  bin/rig.mjs          the commands (start/stop/reset/status/env/migrate)
  bin/supabase.mjs     REST proxy + Storage, http :54321 / https :54331
  bin/clerk.mjs bin/stripe.mjs bin/cloudflare.mjs
  lib/                 config, keys/TLS, Postgres + the chain, seed, storage, env,
                       web push (a stand-in browser, the sink's decryption)
  seed/accounts.json seed/catalogue.mjs
$RIG_DATA_DIR/ (outside the repo)
  pgdata/ keys/ storage/ logs/ run/ state/ (migrations.json, baseline.sql, smoke.json) postgrest.conf
```
