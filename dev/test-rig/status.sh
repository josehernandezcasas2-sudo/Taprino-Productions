#!/usr/bin/env bash
# What is running, on which port, and what the database holds.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/bin/rig.mjs" status "$@"
