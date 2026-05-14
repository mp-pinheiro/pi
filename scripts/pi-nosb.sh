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

SELF="$(readlink -f "$0")"
PI_BIN=""
for candidate in $(which -a pi 2>/dev/null); do
    resolved="$(readlink -f "$candidate" 2>/dev/null)"
    if [ "$resolved" != "$SELF" ]; then
        PI_BIN="$resolved"
        break
    fi
done
[ -z "$PI_BIN" ] && { echo "pi binary not found" >&2; exit 1; }
exec "$PI_BIN" "$@"
