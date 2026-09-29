#!/usr/bin/env bash
# Read-only diagnosis; never prints credentials, manager numbers or customer rows.
set -uo pipefail
cd "$(dirname "$0")/.."
[ ! -d /opt/node22/bin ] || export PATH="/opt/node22/bin:$PATH"
if [ -f /srv/duck-fashion/config/connection.json ]; then export DUCK_CONFIG=/srv/duck-fashion/config/connection.json; fi
export GLACIER_CONFIG="${GLACIER_CONFIG:-/srv/glacier/config/connection.json}"
git log -1 --format='Checkout: %h %s'
git status --short
for unit in duck-fashion.service glacier.service duck-fashion-update.timer; do
  systemctl show "$unit" -p Id -p ActiveState -p SubState
done
systemctl list-timers duck-fashion-update.timer --no-pager
node deploy/health-check.mjs
df -h /srv
