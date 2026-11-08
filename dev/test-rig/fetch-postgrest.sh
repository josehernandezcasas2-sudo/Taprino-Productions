#!/usr/bin/env bash
# Fetches the official PostgREST v12.2.12 static linux x64 release binary
# into the rig's cache directory (outside the repo; never commit it).
# Downloading it was approved by Jose on 2026-11-08. The checksum is the
# one of the asset fetched that day.
#   dev/test-rig/fetch-postgrest.sh
set -euo pipefail
version=12.2.12
sha256=5de4092f1719da3353c40bf96c8dec6913f2254a7cd0b61cc05f233153b557d5
cache="${RIG_CACHE_DIR:-${TMPDIR:-/tmp}/studio-tapa-rig-cache}"
dest="$cache/postgrest-v$version"
if [ -x "$dest/bin/postgrest" ]; then
  echo "already there: $dest/bin/postgrest"
  exit 0
fi
mkdir -p "$dest/dl" "$dest/bin"
ca=()
if [ -f /root/.ccr/ca-bundle.crt ]; then ca=(--cacert /root/.ccr/ca-bundle.crt); fi
curl -sS --fail -L ${ca[@]+"${ca[@]}"} -o "$dest/dl/postgrest.tar.xz" \
  "https://github.com/PostgREST/postgrest/releases/download/v$version/postgrest-v$version-linux-static-x86-64.tar.xz"
echo "$sha256  $dest/dl/postgrest.tar.xz" | sha256sum -c -
tar -xJf "$dest/dl/postgrest.tar.xz" -C "$dest/bin"
"$dest/bin/postgrest" --version
