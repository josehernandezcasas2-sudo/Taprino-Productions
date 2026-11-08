#!/usr/bin/env bash
# Starts the test rig against an app checkout (default: the checkout this
# rig lives in): Postgres (built from that checkout's migrations on first
# start), PostgREST, the Supabase/Clerk/Stripe/Cloudflare stand-ins and
# `next dev -p 3100`. See README.md.
#   dev/test-rig/start.sh [path-to-app-checkout]
#   RIG_MIGRATE_TO=117 dev/test-rig/start.sh     (the database before 118)
#   RIG_REBUILD=1 dev/test-rig/start.sh          (drop and rebuild the database)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/bin/rig.mjs" start "$@"
