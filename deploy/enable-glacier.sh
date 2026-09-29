#!/usr/bin/env bash
# One-time (per machine) switch-on of the Glacier /glacier read API on the Pi:
#   1. requires an existing private database, or an explicit private export path
#   2. adds a glacierApiKey to .local-duck/live-connection.json (generated, kept on this machine)
#   3. prints the key to paste into the John CRM Glacier integration credential
# After running it: sudo systemctl restart duck-fashion
set -euo pipefail
cd "$(dirname "$0")/.."
if node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.env.DUCK_CONFIG||".local-duck/live-connection.json","utf8"));process.exit(c.glacierSeparate?0:1)' 2>/dev/null; then
  echo "Glacier is a separate service. Use: node --import tsx deploy/refresh-glacier.ts /private/path/export.tsv.gz and restart glacier.service."
  exit 1
fi
[ -f package.json ] || { echo "Run this from the bundle root." >&2; exit 1; }
[ $# -le 1 ] || { echo "Usage: bash deploy/enable-glacier.sh [/private/path/glacier.tsv.gz]" >&2; exit 1; }
if [ ! -f data/glacier-icerink.sqlite ]; then
  [ $# -eq 1 ] && [ -f "$1" ] || { echo "Private Glacier database missing. Supply a private export path; exports do not come from Git." >&2; exit 1; }
  echo "Seeding the private Glacier database..."
  npm run seed:glacier -- "$1"
fi
mkdir -p .local-duck
node <<'EOF'
const fs = require("fs");
const path = process.env.DUCK_CONFIG || ".local-duck/live-connection.json";
const config = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
if (!/^[a-f0-9]{64}$/.test(String(config.apiKey ?? ""))) { console.error("live-connection.json has no valid apiKey — run deploy/create-config.sh first."); process.exit(1); }
if (!/^[a-f0-9]{64}$/.test(String(config.glacierApiKey ?? ""))) {
  config.glacierApiKey = require("crypto").randomBytes(32).toString("hex");
  fs.writeFileSync(path + ".tmp", JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(path + ".tmp", path);
  fs.chmodSync(path, 0o600);
  console.log("GLACIER key - paste this into the John CRM Glacier integration credential:");
  console.log("  " + config.glacierApiKey);
} else {
  console.log("glacierApiKey already configured (key not reprinted).");
}
EOF
echo "Now restart the service: sudo systemctl restart duck-fashion"
echo "CRM wiring: baseUrl https://duckserver.johncrm.com (origin only), the manifest at"
echo "johncrm/glacier-api/docs/johncrm-manifest-duckserver.json (paths carry /stock-api/glacier),"
echo "and this key as its api_token. Also add the nginx location for /stock-api/glacier/* ->"
echo "127.0.0.1:4997/glacier/* — see GLACIER.md."
