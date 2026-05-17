#!/usr/bin/env bash
# Docker proxy bridge for pi sandbox.
# Starts a filtering socket-proxy and exports DOCKER_HOST for the sandbox.
#
# The proxy MUST be double-forked so it's never a child of the bash process
# that becomes srt (via exec). Otherwise srt kills it during cleanup.

DOCKER_PROXY_SOCK="/tmp/pi-docker-proxy.sock"
DOCKER_PROXY_BIN="socket-proxy"

ensure_docker_proxy() {
    if ! command -v docker &>/dev/null; then
        return 0
    fi
    if ! command -v "$DOCKER_PROXY_BIN" &>/dev/null; then
        return 0
    fi

    if [ -S "$DOCKER_PROXY_SOCK" ]; then
        if kill -0 "$(cat /tmp/pi-docker-proxy.pid 2>/dev/null)" 2>/dev/null; then
            export DOCKER_HOST="unix://${DOCKER_PROXY_SOCK}"
            return 0
        fi
        rm -f "$DOCKER_PROXY_SOCK"
    fi

    local proxy_bin cwd
    proxy_bin="$(command -v "$DOCKER_PROXY_BIN")"
    cwd="$(pwd)"

    (
        set +e +u +o pipefail
        export SP_ALLOW_GET_0="(/v[0-9.]+)?/_ping"
        export SP_ALLOW_GET_1="/v[0-9.]+/(containers|images|networks|volumes|version|info)(/.*)?"
        export SP_ALLOW_POST_0="/v[0-9.]+/containers/create"
        export SP_ALLOW_POST_1="/v[0-9.]+/containers/[^/]+/(start|stop|restart|exec|attach|logs|wait|kill|resize)"
        export SP_ALLOW_POST_2="/v[0-9.]+/exec/[^/]+/(start|resize|json)"
        export SP_ALLOW_HEAD="(/v[0-9.]+)?/_ping"
        export SP_ALLOW_DELETE="/v[0-9.]+/containers/[^/]+"
        export SP_SOCKETPATH="/var/run/docker.sock"
        export SP_PROXYSOCKETENDPOINT="$DOCKER_PROXY_SOCK"
        export SP_PROXYSOCKETENDPOINTFILEMODE=0660
        export SP_ALLOWBINDMOUNTFROM="$cwd"
        export SP_DENY_PRIVILEGED=true
        export SP_DENY_HOST_NETWORK=true
        export SP_DENY_HOST_PID=true
        export SP_DENY_HOST_IPC=true
        export SP_DENY_DEVICES=true
        export SP_DENY_CAPABILITIES=ALL
        export SP_DENY_SECURITYOPT=true
        export SP_RESOLVE_SYMLINKS=true
        export SP_LOGLEVEL=WARN

        setsid "$proxy_bin" </dev/null >/tmp/pi-docker-proxy.log 2>&1 &
        echo "$!" > /tmp/pi-docker-proxy.pid
    ) || true

    local attempts=0
    while [ ! -S "$DOCKER_PROXY_SOCK" ] && [ $attempts -lt 10 ]; do
        sleep 0.1
        attempts=$((attempts + 1))
    done

    if [ -S "$DOCKER_PROXY_SOCK" ]; then
        export DOCKER_HOST="unix://${DOCKER_PROXY_SOCK}"
    fi
}
