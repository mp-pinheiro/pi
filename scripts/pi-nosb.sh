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

FNM_ROOT="$HOME/.local/share/fnm"
FNM_VER="$(fnm current 2>/dev/null || ls "$FNM_ROOT/node-versions/" 2>/dev/null | head -1)"
PI_BIN="$FNM_ROOT/node-versions/$FNM_VER/installation/bin/pi"
[ -x "$PI_BIN" ] || { echo "pi binary not found at $PI_BIN" >&2; exit 1; }
exec "$PI_BIN" "$@"
