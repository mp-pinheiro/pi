#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRT_SETTINGS="${PI_SRT_SETTINGS:-$HOME/.pi/agent/srt.json}"

if [ -f "$HOME/.zsh_secrets" ]; then
    set -a
    . "$HOME/.zsh_secrets"
    set +a
fi

. "$SCRIPT_DIR/lib-preflight.sh"
resolve_web_provider

export npm_config_prefix="$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")"
exec srt --settings "$SRT_SETTINGS" pi "$@"
