#!/usr/bin/env bash
# One existing timer; exact-commit CI gate; data lives outside the Git checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
[ ! -d /opt/node22/bin ] || export PATH="/opt/node22/bin:$PATH"
export DUCK_CONFIG="${DUCK_CONFIG:-$PWD/.local-duck/live-connection.json}"
export GLACIER_CONFIG="${GLACIER_CONFIG:-/srv/glacier/config/connection.json}"
log() { echo "[duck-fashion-update] $*"; }
die() { log "ERROR: $*"; exit 1; }
exec 9>/tmp/duck-fashion-update.lock
flock -n 9 || exit 0
git fetch origin main || die "Fetch failed; retaining the running release."
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse origin/main)
REPAIR=false
[ "${1:-}" != "--repair" ] || REPAIR=true
if [ "$OLD" = "$NEW" ] && ! $REPAIR; then log "Already at $OLD."; exit 0; fi
[ -z "$(git status --porcelain)" ] || die "Checkout has local edits; preserve/reconcile them before deployment."
git merge-base --is-ancestor "$OLD" "$NEW" || die "Cannot fast-forward; operator reconciliation required."
node deploy/check-ci.mjs "$NEW" || die "Waiting for successful CI on this exact main commit."

# Inspect runtime config without printing credentials.
separate=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.DUCK_CONFIG,"utf8")); console.log(c.glacierSeparate ? "true" : "false")')
duck_changed=false
glacier_changed=false
while IFS= read -r file; do
  case "$file" in
    server/glacier/proxy.ts|server/glacier/mount.ts) duck_changed=true ;;
    server/glacier/*|server/glacier-seed.ts) glacier_changed=true ;;
    package*.json|deploy/*) duck_changed=true; glacier_changed=true ;;
    server/*|config/duck-fashion/*|data/*) duck_changed=true ;;
  esac
done < <(git diff --name-only "$OLD" "$NEW")
if $REPAIR; then duck_changed=true; glacier_changed=true; fi
if ! $separate && $glacier_changed; then duck_changed=true; fi

node --import tsx deploy/backup.ts || die "Backup failed; keeping the current release."
old_lock=$(sha256sum package-lock.json | cut -d' ' -f1)
deps_changed=false
restart_services() {
  if $duck_changed; then sudo -n /usr/bin/systemctl restart duck-fashion.service || return 1; fi
  if $separate && $glacier_changed; then sudo -n /usr/bin/systemctl restart glacier.service || return 1; fi
  return 0
}
rollback() {
  log "Restoring code to $OLD; preserving private Duck and Glacier data."
  git reset --hard "$OLD" >/dev/null || return 1
  if $deps_changed; then npm ci --no-audit --no-fund || return 1; fi
  restart_services
}
failed() { rollback || log "Rollback needs operator attention."; die "$1"; }
log "Deploying ${OLD:0:12} -> ${NEW:0:12}."
git merge --ff-only origin/main >/dev/null || die "Fast-forward failed."
if [ "$(sha256sum package-lock.json | cut -d' ' -f1)" != "$old_lock" ]; then
  deps_changed=true
  npm ci --no-audit --no-fund || failed "Dependency install failed."
fi
# Private Glacier datasets are never replaced or refreshed by a code deploy.
restart_services || failed "Service restart failed."
for _ in $(seq 1 10); do
  if node deploy/health-check.mjs; then log "Deployed $NEW and healthy."; exit 0; fi
  sleep 1
done
failed "Service health checks failed."
