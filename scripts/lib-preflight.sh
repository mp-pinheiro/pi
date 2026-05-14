#!/usr/bin/env bash
# Shared pre-flight checks for pi launchers.
# Sourced by pi-sb.sh and pi-nosb.sh — not executed directly.

resolve_web_provider() {
    local wp="$HOME/.pi/agent/web-providers.json"

    if [ ! -f "$wp" ]; then return; fi
    if ! command -v jq &>/dev/null; then return; fi

    local target="exa"

    if [ -z "${EXA_API_KEY:-}" ]; then
        target="brave"
    else
        local exa_code
        exa_code=$(curl -s -o /dev/null -w '%{http_code}' \
            --connect-timeout 2 --max-time 3 \
            -H "x-api-key: $EXA_API_KEY" \
            "https://api.exa.ai/search" 2>/dev/null)
        case "$exa_code" in
            401|402|403|429) target="brave" ;;
        esac
    fi

    local current
    current=$(jq -r '.tools.search' "$wp")

    if [ "$current" != "$target" ]; then
        jq --arg t "$target" \
            '.tools.search=$t | .tools.contents=$t | .tools.answer=$t | .tools.research=$t' \
            "$wp" > "$wp.tmp"
        mv "$wp.tmp" "$wp"
        if [ "$target" = "brave" ]; then
            printf '\033[0;33m[!]\033[0m Exa unavailable, falling back to Brave\n' >&2
        fi
    fi
}
