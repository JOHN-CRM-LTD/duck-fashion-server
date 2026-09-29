#!/usr/bin/env bash
# Run once with sudo from the deployed checkout. Preserves original data and units.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$(pwd -P)
[ "$(id -u)" = 0 ] || { echo "Run: sudo bash deploy/install-layout.sh [existing-config-path]"; exit 1; }
[[ "$repo" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo "Unsupported checkout path."; exit 1; }
[ "$repo" = "$(systemctl show duck-fashion.service -p WorkingDirectory --value)" ] || { echo "Run inside the actual installed Duck checkout."; exit 1; }
unit_user=$(systemctl show duck-fashion.service -p User --value)
[[ "$unit_user" =~ ^[a-z_][a-z0-9_-]*$ ]] && [ "$unit_user" != root ] || { echo "An existing unprivileged service user is required."; exit 1; }
unit_group=$(id -gn "$unit_user")
node_bin=$(systemctl show duck-fashion.service -p ExecStart --value | sed -n 's/.*path=\([^ ;]*\).*/\1/p')
[[ "$node_bin" =~ ^/[a-zA-Z0-9_./-]+$ ]] && [ -x "$node_bin" ] || { echo "Could not determine the existing Node runtime."; exit 1; }
source_config=$(realpath "${1:-.local-duck/live-connection.json}")
[[ "$source_config" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo "Unsupported private config path."; exit 1; }
for target in /srv/duck-fashion /srv/glacier /etc/systemd/system/glacier.service /etc/systemd/system/duck-fashion.service.d/50-demo-layout.conf /etc/systemd/system/duck-fashion-update.service.d/50-demo-layout.conf /etc/sudoers.d/duck-glacier-update; do
  [ ! -e "$target" ] || { echo "Already exists: $target. Inspect/resume manually; no overwrite performed."; exit 1; }
done
runuser -u "$unit_user" -- git diff --quiet
[ -z "$(runuser -u "$unit_user" -- git status --porcelain)" ] || { echo "Reconcile local source edits before migration."; exit 1; }
command -v visudo >/dev/null
exec 9>/tmp/duck-fashion-update.lock
flock -n 9 || { echo "A deployment is in progress. Retry after it finishes."; exit 1; }
timer_active=false
systemctl is-active --quiet duck-fashion-update.timer && timer_active=true
service_active=false
systemctl is-active --quiet duck-fashion.service && service_active=true
systemctl stop duck-fashion-update.timer
temp=$(mktemp -d)
changed_units=false
success=false
cleanup() {
  if ! $success; then
    echo "Migration did not complete; restoring the original services. Prepared /srv data is retained for inspection."
    if $changed_units; then
      systemctl disable --now glacier.service || true
      rm -f /etc/systemd/system/glacier.service /etc/systemd/system/duck-fashion.service.d/50-demo-layout.conf /etc/systemd/system/duck-fashion-update.service.d/50-demo-layout.conf /etc/sudoers.d/duck-glacier-update
      systemctl daemon-reload
    fi
    if $service_active; then systemctl restart duck-fashion.service; fi
  fi
  if $timer_active; then systemctl start duck-fashion-update.timer; fi
  rm -rf -- "$temp"
}
trap cleanup EXIT
systemctl stop duck-fashion.service
"$node_bin" --import tsx deploy/prepare-layout.ts "$source_config"
chown -R "$unit_user:$unit_group" /srv/duck-fashion /srv/glacier
chmod -R u=rwX,go= /srv/duck-fashion /srv/glacier
cat > "$temp/duck.conf" <<EOF
[Service]
Environment=DUCK_CONFIG=/srv/duck-fashion/config/connection.json
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/srv/duck-fashion
InaccessiblePaths=/srv/glacier -$repo/.local-duck $source_config
EOF
cat > "$temp/glacier.service" <<EOF
[Unit]
Description=Glacier IceRink read API
After=network.target
[Service]
Type=simple
User=$unit_user
WorkingDirectory=$repo
Environment=GLACIER_CONFIG=/srv/glacier/config/connection.json
ExecStart=$node_bin --import tsx server/glacier/api.ts
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
InaccessiblePaths=/srv/duck-fashion -$repo/.local-duck $source_config
[Install]
WantedBy=multi-user.target
EOF
cat > "$temp/update.conf" <<EOF
[Service]
Environment=DUCK_CONFIG=/srv/duck-fashion/config/connection.json
Environment=GLACIER_CONFIG=/srv/glacier/config/connection.json
Environment=PATH=$(dirname "$node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=
ExecStart=/usr/bin/bash $repo/deploy/pull-update.sh
TimeoutStartSec=300
UMask=0077
EOF
echo "$unit_user ALL=(root) NOPASSWD: /usr/bin/systemctl restart glacier.service" > "$temp/sudoers"
visudo -cf "$temp/sudoers"
changed_units=true
install -D -m 0644 "$temp/duck.conf" /etc/systemd/system/duck-fashion.service.d/50-demo-layout.conf
install -D -m 0644 "$temp/glacier.service" /etc/systemd/system/glacier.service
install -D -m 0644 "$temp/update.conf" /etc/systemd/system/duck-fashion-update.service.d/50-demo-layout.conf
install -m 0440 "$temp/sudoers" /etc/sudoers.d/duck-glacier-update
systemctl daemon-reload
systemctl enable --now glacier.service
systemctl start duck-fashion.service
export DUCK_CONFIG=/srv/duck-fashion/config/connection.json
export GLACIER_CONFIG=/srv/glacier/config/connection.json
for _ in $(seq 1 10); do
  if "$node_bin" deploy/health-check.mjs; then success=true; break; fi
  sleep 1
done
$success || exit 1
echo "Duck Fashion: /srv/duck-fashion, port 4997; Glacier: /srv/glacier, port 4998."
echo "Both healthy. Existing /glacier URLs continue through the compatibility proxy."
echo "Next: use deploy/nginx-demo-services.conf.example for direct routing and optional remote admin."
