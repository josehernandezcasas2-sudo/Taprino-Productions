#!/usr/bin/env bash
# Stops everything the rig started (the data stays for the next start).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/bin/rig.mjs" stop "$@"
