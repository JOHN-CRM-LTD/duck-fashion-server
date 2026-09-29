#!/usr/bin/env bash
# Creates missing keys; changing the URL never rotates existing credentials.
set -euo pipefail
[ $# -eq 1 ] || { echo 'Usage: bash deploy/create-config.sh https://public-host/stock-api' >&2; exit 1; }
script_dir=$(cd "$(dirname "$0")" && pwd)
node "$script_dir/create-config.mjs" "$1"
