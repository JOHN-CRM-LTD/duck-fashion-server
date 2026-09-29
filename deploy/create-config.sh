#!/usr/bin/env bash
# Creates missing keys; changing the URL never rotates existing credentials.
set -euo pipefail
[ $# -eq 1 ] || { echo 'Usage: bash deploy/create-config.sh https://public-host/stock-api' >&2; exit 1; }
cd "$(dirname "$0")/.."
node deploy/create-config.mjs "$1"
