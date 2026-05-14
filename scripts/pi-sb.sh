#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRT_SETTINGS="${PI_SRT_SETTINGS:-$HOME/.pi/srt.json}"

if [ -f "$HOME/.zsh_secrets" ]; then
    set -a
    . "$HOME/.zsh_secrets"
    set +a
fi

. "$SCRIPT_DIR/lib-preflight.sh"
resolve_web_provider

FNM_ROOT="$HOME/.local/share/fnm"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-env-proxy"
export npm_config_prefix="$FNM_ROOT/node-versions/$(fnm current 2>/dev/null || ls "$FNM_ROOT/node-versions/" 2>/dev/null | head -1)/installation"
exec srt --settings "$SRT_SETTINGS" pi "$@"
