#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$HOME/.zsh_secrets" ]; then
    set -a
    . "$HOME/.zsh_secrets"
    set +a
fi

. "$SCRIPT_DIR/lib-preflight.sh"
resolve_web_provider

PI_BIN="$(readlink -f "$(command -v pi)")" || { echo "pi not found" >&2; exit 1; }
exec "$PI_BIN" "$@"
