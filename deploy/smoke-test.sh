#!/usr/bin/env bash
# Boots the API locally and checks the endpoints end to end. Used by GitHub
# Actions on every push. Run manually only in a throwaway checkout/database:
# these checks change stock and import a synthetic customer.
# Requires: npm install + npm run seed + bash deploy/create-config.sh <url>,
# node deploy/create-staff-read-key.mjs and the --demo location import.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -d /opt/node22/bin ] && export PATH="/opt/node22/bin:$PATH"
BASE=http://127.0.0.1:4997
fail=0
check() { # name expected command...
  local name=$1 expected=$2; shift 2
  local got
  got=$("$@" 2>/dev/null || true)
  if [ "$got" = "$expected" ]; then echo "ok   $name"; else echo "FAIL $name (expected '$expected', got '${got:-nothing}')"; fail=1; fi
}

KEY=$(node -p 'JSON.parse(require("fs").readFileSync(".local-duck/live-connection.json","utf8")).apiKey')
WRITE_KEY=$(node -p 'JSON.parse(require("fs").readFileSync(".local-duck/live-connection.json","utf8")).writeApiKey')
STAFF_READ_KEY=$(node -p 'JSON.parse(require("fs").readFileSync(".local-duck/live-connection.json","utf8")).staffReadApiKey')
[ -f data/duck-fashion.sqlite ] || { echo "data/duck-fashion.sqlite missing — run: npm run seed"; exit 1; }

# Never boot a second copy against the live service's port: the adjustment
# test below would hit production stock.
if curl -s -o /dev/null --max-time 2 "$BASE/shops" && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/shops")" != "000" ]; then
  echo "something is already listening on $BASE. Use an isolated test environment; do not stop production for this smoke test."; exit 1
fi

node --import tsx server/capsule-api.ts &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  curl -sf -o /dev/null -H "Authorization: Bearer $KEY" "$BASE/shops" && break
  sleep 1
done

check "unauthenticated request is rejected" 401 curl -s -o /dev/null -w '%{http_code}' "$BASE/shops"
check "GET /shops answers 200"              200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/shops"
check "GET /products?query=hoodie answers"  200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/products?query=hoodie"
check "GET /inventory?query=hoodie answers" 200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/inventory?query=hoodie"
check "product photo is served"             200 curl -s -o /dev/null -w '%{http_code}' "$BASE/images/black_hoodie.png"
check "unknown route answers 404"           404 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/nope"
check "customer lookup requires authentication" 401 curl -s -o /dev/null -w '%{http_code}' "$BASE/customers/lookup?phone=85261234567"
check "customer lookup requires a phone" 400 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/customers/lookup"
check "read key cannot import customers" 403 curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"customers":[]}' "$BASE/customers/import"
curl -sf -X POST -H "Authorization: Bearer $WRITE_KEY" -H 'Content-Type: application/json' -d '{"customers":[{"id":"TEST-HK","name":"Example customer","phone":"+85261234567"}]}' "$BASE/customers/import" >/dev/null
customer=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/customers/lookup?phone=85261234567" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).customers[0].id')
[ "$customer" = "TEST-HK" ] && echo "ok   existing demo customer matched" || { echo "FAIL customer lookup"; fail=1; }
unknown=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/customers/lookup?phone=85261234568" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).customers.length')
[ "$unknown" = "0" ] && echo "ok   unknown customer stays unregistered" || { echo "FAIL unknown customer lookup"; fail=1; }

shops=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/shops" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).shops.length')
[ "$shops" = "3" ] && echo "ok   three shops returned" || { echo "FAIL expected 3 shops, got $shops"; fail=1; }

stock=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/inventory?query=beanie" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).items.length')
[ "$stock" -gt 0 ] && echo "ok   beanie inventory has $stock rows" || { echo "FAIL beanie inventory empty"; fail=1; }

# Write credential flow: one idempotent stock adjustment, replayed by requestId.
adj=$(curl -sf -X POST -H "Authorization: Bearer $WRITE_KEY" -H 'Content-Type: application/json' \
  -d '{"sku":"DF06-BLK-S","locationId":"PCL","delta":1,"expectedVersion":1,"reason":"smoke test","requestId":"smoketest-0001"}' \
  "$BASE/stock/adjust" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).adjustment.quantityAfter')
[ "$adj" = "5" ] && echo "ok   stock adjustment applied (4 -> 5)" || { echo "FAIL adjustment quantityAfter=$adj"; fail=1; }

# Member bonus points (tables are boot-seeded by capsule-api via seedBonus).
check "bonus balance requires identity" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/bonus/balance"
check "unknown bonus member reveals no candidates" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/bonus/balance?member=NOBODY99&phone=85261234505"
check "wrong member phone is rejected" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/bonus/balance?member=DF1005&phone=85261234591"
check "manager directory is private" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/managers"
check "staff read key can read managers" 200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $STAFF_READ_KEY" "$BASE/managers"
check "locations stay private" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/shops?mode=locations"
check "staff read key can read locations" 200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $STAFF_READ_KEY" "$BASE/shops?mode=locations"
check "staff read key cannot import customers" 403 curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $STAFF_READ_KEY" -H 'Content-Type: application/json' -d '{"customers":[]}' "$BASE/customers/import"
check "staff read key cannot adjust stock" 403 curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $STAFF_READ_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/stock/adjust"
check "bonus cash-scheme answers 200"    200 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/bonus/cash-scheme"
balance=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/bonus/balance?member=DF1005&phone=%2B852%206123%204505" | node -p 'const b=JSON.parse(require("fs").readFileSync(0,"utf8")); b.member.memberCode==="DF1005" && Number.isInteger(b.availablePoints) && b.availablePoints>=0 ? "ok" : JSON.stringify(b.member)')
[ "$balance" = "ok" ] && echo "ok   bonus balance by mobile resolves DF1005" || { echo "FAIL bonus balance by mobile: $balance"; fail=1; }
check "archived demo account stays unavailable" 403 curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE/bonus/balance?member=DF-DEMO-AU&phone=85261234591"
redeemables=$(curl -sf -H "Authorization: Bearer $KEY" "$BASE/bonus/redeemables?member=DF1005&phone=85261234505" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).items.length')
[ "$redeemables" = "9" ] && echo "ok   nine bonus redeemables listed" || { echo "FAIL bonus redeemables: $redeemables"; fail=1; }

if [ $fail -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "SMOKE TEST FAILED"; exit 1; fi
