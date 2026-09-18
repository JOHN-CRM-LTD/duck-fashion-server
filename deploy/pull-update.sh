#!/usr/bin/env bash
# CI/CD pull deploy for the Duck Fashion Pi.
#
# Runs every few minutes from duck-fashion-update.timer (and can be run by
# hand). It checks GitHub for new commits on main and, when one arrives:
# fast-forward pulls it, reinstalls dependencies if the lockfile changed,
# restarts the duck-fashion service, health-checks it, and rolls the commit
# back if the service does not come up. The live SQLite database and the
# connection keys are gitignored, so a deploy never touches live stock or
# credentials.
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH=main
REMOTE=origin
NODE22=/opt/node22/bin
[ -d "$NODE22" ] && export PATH="$NODE22:$PATH"

log() { echo "[duck-fashion-update] $*"; }
die() { log "ERROR: $*"; exit 1; }

# One run at a time (timer + manual run can overlap).
exec 9>/tmp/duck-fashion-update.lock
flock -n 9 || { log "another update is already running, exiting."; exit 0; }

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  log "no '$REMOTE' remote configured yet — nothing to pull from."
  exit 0
fi

git fetch "$REMOTE" "$BRANCH" || die "git fetch failed (offline?); trying again on the next timer run."

OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "$REMOTE/$BRANCH")
if [ "$OLD" = "$NEW" ]; then
  log "already at $OLD — up to date."
  exit 0
fi

# Refuse to deploy over local edits made directly on the Pi.
if [ -n "$(git status --porcelain)" ]; then
  die "working tree is dirty; commit or stash local changes first. NOT deploying."
fi

OLD_LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
rollback() {
  log "rolling back to $OLD."
  git reset --hard "$OLD" >/dev/null
  if [ "$(sha256sum package-lock.json | cut -d' ' -f1)" != "$OLD_LOCK_HASH" ]; then
    npm ci --no-audit --no-fund >/dev/null 2>&1 || log "WARNING: dependency rollback install failed."
  fi
  sudo -n /usr/bin/systemctl restart duck-fashion.service || die "could not restart the service during rollback!"
}

log "deploying $(git rev-parse --short "$OLD") -> $(git rev-parse --short "$NEW")."
git merge --ff-only "$REMOTE/$BRANCH" >/dev/null || die "cannot fast-forward to $NEW; NOT deploying."

if [ "$(sha256sum package-lock.json | cut -d' ' -f1)" != "$OLD_LOCK_HASH" ]; then
  log "package-lock.json changed — running npm ci."
  if ! npm ci --no-audit --no-fund; then rollback; die "npm ci failed after pull."; fi
fi

log "restarting duck-fashion.service."
sudo -n /usr/bin/systemctl restart duck-fashion.service || { rollback; die "systemctl restart failed."; }

read_key=$(node -p 'JSON.parse(require("fs").readFileSync(".local-duck/live-connection.json","utf8")).apiKey') \
  || { rollback; die "could not read the read key for the health check."; }
log "health-checking http://127.0.0.1:4997/shops ..."
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $read_key" http://127.0.0.1:4997/shops || true)
  customer_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $read_key" 'http://127.0.0.1:4997/customers/lookup?phone=85261234568' || true)
  [ "$code" = "200" ] && [ "$customer_code" = "200" ] && { log "deployed $(git rev-parse --short HEAD) and healthy (stock and customer lookup)."; exit 0; }
  sleep 1
done
rollback
die "service did not become healthy on the new commit (last HTTP status: ${code:-none})."
