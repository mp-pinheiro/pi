#!/usr/bin/env bash
set -euo pipefail

# Sandboxed pi launcher.
#   - srt (Anthropic sandbox-runtime) enforces the policy in ~/.pi/agent/srt.json
#   - Filesystem: $PWD + ~/.pi only; rest of home is invisible
#   - Network: OpenRouter only
[ -f "$HOME/.zsh_secrets" ] && set -a && . "$HOME/.zsh_secrets" && set +a

PI_BIN="$(readlink -f "$(command -v pi)")" || { echo "pi not found" >&2; exit 1; }
exec srt --settings "$HOME/.pi/agent/srt.json" "$PI_BIN" "$@"
