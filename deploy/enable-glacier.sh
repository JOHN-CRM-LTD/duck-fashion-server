#!/usr/bin/env bash
# One-time (per machine) switch-on of the Glacier /glacier read API on the Pi:
#   1. seeds data/glacier-icerink.sqlite from the committed snapshot (if not present)
#   2. adds a glacierApiKey to .local-duck/live-connection.json (generated, kept on this machine)
#   3. prints the key to paste into the John CRM Glacier integration credential
# After running it: sudo systemctl restart duck-fashion
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f package.json ] || { echo "Run this from the bundle root." >&2; exit 1; }
[ -f data/glacier-icerink.tsv.gz ] || { echo "data/glacier-icerink.tsv.gz missing — git pull first." >&2; exit 1; }
if [ ! -f data/glacier-icerink.sqlite ]; then
  echo "Seeding data/glacier-icerink.sqlite from the snapshot (a minute or two)..."
  npm run seed:glacier
fi
mkdir -p .local-duck
node <<'EOF'
const fs = require("fs");
const path = ".local-duck/live-connection.json";
const config = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
if (!/^[a-f0-9]{64}$/.test(String(config.apiKey ?? ""))) { console.error("live-connection.json has no valid apiKey — run deploy/create-config.sh first."); process.exit(1); }
if (!/^[a-f0-9]{64}$/.test(String(config.glacierApiKey ?? ""))) {
  config.glacierApiKey = require("crypto").randomBytes(32).toString("hex");
  const ordered = { mode: config.mode, port: config.port, apiKey: config.apiKey, writeApiKey: config.writeApiKey, glacierApiKey: config.glacierApiKey, dataDirectory: config.dataDirectory, url: config.url };
  fs.writeFileSync(path, JSON.stringify(ordered, null, 2) + "\n");
  console.log("GLACIER key - paste this into the John CRM Glacier integration credential:");
  console.log("  " + config.glacierApiKey);
} else {
  console.log("glacierApiKey already configured (key not reprinted).");
}
EOF
echo "Now restart the service: sudo systemctl restart duck-fashion"
echo "CRM wiring: baseUrl = the tunnel origin only (e.g. https://glacier.johncrm.com via a named"
echo "cloudflared tunnel on this Pi — no DigitalOcean in the path), the manifest at"
echo "johncrm/glacier-api/docs/johncrm-manifest-duckserver.json (paths carry /glacier),"
echo "and this key as its api_token. See GLACIER.md for the tunnel setup."
