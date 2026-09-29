#!/usr/bin/env bash
# Isolated deploy harness: real Git repositories, fake services/Node/npm.
set -euo pipefail
source_script=$(realpath "$(dirname "$0")/pull-update.sh")
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/work/deploy"
git init --bare -q "$temp/origin"
git -C "$temp/work" init -q -b main
git -C "$temp/work" config user.name 'Deployment test'
git -C "$temp/work" config user.email 'deploy-test@example.invalid'
git -C "$temp/work" config core.autocrlf false
cp "$source_script" "$temp/work/deploy/pull-update.sh"
printf 'old-lock\n' > "$temp/work/package-lock.json"
git -C "$temp/work" add .
git -C "$temp/work" commit -qm old
old=$(git -C "$temp/work" rev-parse HEAD)
git -C "$temp/work" remote add origin "$temp/origin"
git -C "$temp/work" push -q origin main
printf 'new-lock\n' > "$temp/work/package-lock.json"
git -C "$temp/work" commit -qam new
new=$(git -C "$temp/work" rev-parse HEAD)
git -C "$temp/work" push -q origin main
git -C "$temp/work" reset -q --hard "$old"
cat > "$temp/bin/node" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *check-ci.mjs*) exit "$GATE_STATUS" ;;
  *health-check.mjs*) exit "$HEALTH_STATUS" ;;
  *backup.ts*) echo backup >> "$TRACE" ;;
  *refresh-glacier.ts*) echo refresh >> "$TRACE" ;;
  *databasePath*) echo '' ;;
  *glacierSeparate*) echo false ;;
  *) echo "Unexpected node invocation" >&2; exit 1 ;;
esac
EOF
cat > "$temp/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf 'npm:%s\n' "$(cat package-lock.json)" >> "$TRACE"
EOF
cat > "$temp/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo restart >> "$TRACE"
EOF
cat > "$temp/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH" TRACE="$temp/trace" GATE_STATUS=1 HEALTH_STATUS=0
# CI rejection must leave code untouched and must not run a backup/restart/install.
if bash "$temp/work/deploy/pull-update.sh" > "$temp/log" 2>&1; then echo 'FAIL: CI rejection deployed'; exit 1; fi
[ "$(git -C "$temp/work" rev-parse HEAD)" = "$old" ]
[ ! -e "$TRACE" ]
echo 'ok: failed/pending CI preserves the running release'

# Health failure after dependency change must reinstall OLD dependencies too.
export GATE_STATUS=0 HEALTH_STATUS=1
if bash "$temp/work/deploy/pull-update.sh" > "$temp/log" 2>&1; then echo 'FAIL: unhealthy release deployed'; exit 1; fi
[ "$(git -C "$temp/work" rev-parse HEAD)" = "$old" ]
grep -q '^npm:new-lock$' "$TRACE"
grep -q '^npm:old-lock$' "$TRACE"
[ "$(grep -c '^restart$' "$TRACE")" = 2 ]
echo 'ok: unhealthy release restores old code AND old dependencies'

export HEALTH_STATUS=0
bash "$temp/work/deploy/pull-update.sh" > "$temp/log" 2>&1
[ "$(git -C "$temp/work" rev-parse HEAD)" = "$new" ]
! grep -q '^refresh$' "$TRACE"
echo 'ok: healthy tested release deploys successfully'
