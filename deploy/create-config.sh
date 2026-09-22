#!/usr/bin/env bash
# Run from the bundle root after the tunnel is up:
#   bash deploy/create-config.sh https://<something>.trycloudflare.com
set -euo pipefail
if [ $# -ne 1 ]; then echo "Usage: bash deploy/create-config.sh https://<your-tunnel-url>" >&2; exit 1; fi
case "$1" in https://*) ;; *) echo "The public URL must start with https://" >&2; exit 1; esac
[ -f package.json ] || { echo "Run this from the bundle root (the folder containing package.json)." >&2; exit 1; }
read_key=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
write_key=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
glacier_key=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
mkdir -p .local-duck
node - "$1" "$read_key" "$write_key" "$glacier_key" "$PWD/data" <<'NODE_SCRIPT_EOF'
const fs = require("fs");
const [url, apiKey, writeApiKey, glacierApiKey, dataDirectory] = process.argv.slice(2);
fs.writeFileSync(".local-duck/live-connection.json",
  JSON.stringify({ mode: "capsule", port: 4997, apiKey, writeApiKey, glacierApiKey, dataDirectory, url }, null, 2) + "\n");
NODE_SCRIPT_EOF
echo "Wrote .local-duck/live-connection.json (data: $PWD/data, url: $1)"
echo "READ key - paste this into the John CRM integration credential:"
echo "  $read_key"
echo "WRITE key - staff stock adjustments only, keep private, do not put in CRM:"
echo "  $write_key"
echo "GLACIER key - IceRink snapshot read API (/glacier), separate CRM credential:"
echo "  $glacier_key"
