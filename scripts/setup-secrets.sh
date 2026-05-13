#!/usr/bin/env bash
set -euo pipefail

SECRETS_FILE="$HOME/.zsh_secrets"

has_key() { grep -q "^export $1=" "$SECRETS_FILE" 2>/dev/null; }

prompt_key() {
    local name="$1" desc="$2" value=""
    if has_key "$name"; then return; fi
    printf '%s (%s): ' "$name" "$desc"
    read -r value
    if [ -n "$value" ]; then
        echo "export $name=\"$value\"" >> "$SECRETS_FILE"
    fi
}

prompt_key Z_AI_API_KEY "z.ai subscription, default provider"
prompt_key OPENROUTER_API_KEY "openrouter.ai, Claude/Kimi/Gemini models"
prompt_key BRAVE_API_KEY "api.search.brave.com, web search tools"

if [ -f "$SECRETS_FILE" ]; then
    chmod 600 "$SECRETS_FILE"
fi
