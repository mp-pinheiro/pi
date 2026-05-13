#!/usr/bin/env bash
set -euo pipefail

[ -f "$HOME/.zsh_secrets" ] && set -a && . "$HOME/.zsh_secrets" && set +a

PI_BIN="$(readlink -f "$(command -v pi)")" || { echo "pi not found" >&2; exit 1; }
exec "$PI_BIN" "$@"
