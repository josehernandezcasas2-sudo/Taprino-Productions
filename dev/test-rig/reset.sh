#!/usr/bin/env bash
# Puts the rig back to the seed: every public table truncated, the data the
# migration chain itself writes restored, the seed rows and pictures
# written again, and the fake Clerk/Stripe/Cloudflare back to their seed.
#   dev/test-rig/reset.sh              (fast: truncate + reseed)
#   dev/test-rig/reset.sh --rebuild    (drop the database and run the chain again)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/bin/rig.mjs" reset "$@"
