#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SRT_SETTINGS="${PI_SRT_SETTINGS:-$HOME/.pi/srt.json}"

if [ -f "$HOME/.zsh_secrets" ]; then
    set -a
    . "$HOME/.zsh_secrets"
    set +a
fi

. "$SCRIPT_DIR/lib-preflight.sh"
. "$SCRIPT_DIR/lib-docker-proxy.sh"
resolve_web_provider
ensure_docker_proxy

FNM_ROOT="$HOME/.local/share/fnm"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-env-proxy"
export npm_config_prefix="$FNM_ROOT/node-versions/$(fnm current 2>/dev/null || ls "$FNM_ROOT/node-versions/" 2>/dev/null | head -1)/installation"
# srt invokes bwrap with --new-session, detaching pi from the controlling
# terminal session. SIGWINCH never reaches pi. Spawn a background monitor
# that polls terminal size and walks /proc to send SIGWINCH to descendants.
exec 3<&0
(
    exec 0<&3 3<&-
    trap '' HUP
    target=$$
    sleep 2
    prev=$(stty size 2>/dev/null) || exit 0
    while kill -0 "$target" 2>/dev/null; do
        curr=$(stty size 2>/dev/null) || break
        if [ "$curr" != "$prev" ]; then
            queue="$target"
            while [ -n "$queue" ]; do
                nxt=""
                for p in $queue; do
                    kill -WINCH "$p" 2>/dev/null || true
                    nxt="$nxt $(cat /proc/$p/task/$p/children 2>/dev/null || true)"
                done
                queue=$(echo $nxt)
            done
            prev=$curr
        fi
        sleep 0.3
    done
) &
exec 3<&-
exec srt --settings "$SRT_SETTINGS" pi "$@"
