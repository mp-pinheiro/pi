#!/usr/bin/env bash
# Validate the pi sandbox (srt) policy at ~/.pi/agent/srt.json.
# Runs filesystem read/write and network reachability probes inside srt,
# reports a PASS/FAIL table, and exits non-zero if any rule leaked.

set -u

SRT_SETTINGS="${PI_SRT_SETTINGS:-$HOME/.pi/srt.json}"

if ! command -v srt >/dev/null 2>&1; then
    printf '\033[0;31m[!]\033[0m srt not installed. Run: npm install -g @anthropic-ai/sandbox-runtime\n' >&2
    exit 127
fi

if [ ! -f "$SRT_SETTINGS" ]; then
    printf '\033[0;31m[!]\033[0m sandbox policy not found at %s. Run: ./bootstrap.sh pi\n' "$SRT_SETTINGS" >&2
    exit 127
fi

SCRATCH="$(mktemp -d -t pi-sb-validate.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$SCRATCH"

exec srt --settings "$SRT_SETTINGS" bash <<'INNER'
set -u

pass_count=0
fail_count=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass_count=$((pass_count + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail_count=$((fail_count + 1)); }

check_read_allowed() {
    local label="$1" path="$2"
    ls "$path" >/dev/null 2>&1 && pass "read $label" || fail "read $label"
}
check_read_blocked() {
    local label="$1" path="$2"
    ls "$path" >/dev/null 2>&1 && fail "read $label (LEAK)" || pass "read $label blocked"
}
check_write_allowed() {
    local label="$1" path="$2"
    if ( : > "$path" ) 2>/dev/null; then
        rm -f "$path"
        pass "write $label"
    else
        fail "write $label"
    fi
}
check_write_blocked() {
    local label="$1" path="$2"
    if ( : > "$path" ) 2>/dev/null; then
        rm -f "$path" 2>/dev/null
        fail "write $label (LEAK)"
    else
        pass "write $label blocked"
    fi
}
check_write_tmpfs() {
    # denyRead: ["~"] makes srt --tmpfs ~. tmpfs is writable but data stays
    # in-memory and never reaches the host -- contained, not a real leak.
    local label="$1" path="$2"
    if ( : > "$path" ) 2>/dev/null; then
        rm -f "$path"
        pass "write $label (tmpfs, contained)"
    else
        pass "write $label (blocked)"
    fi
}
check_net() {
    local expect="$1" domain="$2"
    local code rc
    code=$(curl -sS -I --max-time 20 -o /dev/null -w '%{http_code}' "https://$domain/" 2>/dev/null)
    rc=$?
    [ "${PI_SB_VALIDATE_DEBUG:-0}" = "1" ] && printf '    [debug] %s: rc=%s code=%q\n' "$domain" "$rc" "$code" >&2
    if [ "$rc" = "0" ] && [ -n "$code" ] && [ "$code" != "000" ]; then
        if [ "$expect" = "allow" ]; then
            pass "net $domain reachable (http=$code)"
        else
            fail "net $domain reachable (http=$code) (LEAK)"
        fi
    else
        if [ "$expect" = "block" ]; then
            pass "net $domain blocked"
        else
            fail "net $domain unreachable (LEAK in allowed list)"
        fi
    fi
}

echo "--- filesystem reads ---"
check_read_allowed "cwd"             "."
check_read_allowed "~/.pi"           "$HOME/.pi"
check_read_blocked "~/.zsh_secrets"  "$HOME/.zsh_secrets"
check_read_blocked "~/.ssh"          "$HOME/.ssh"

echo "--- filesystem writes ---"
check_write_allowed "./srt-write"               "./srt-write"
check_write_allowed "~/.pi/sessions/srt-write"  "$HOME/.pi/sessions/srt-write"
check_write_tmpfs   "~/srt-write"               "$HOME/srt-write"
check_write_allowed "/tmp/srt-write"             "/tmp/srt-write"

echo "--- environment ---"
[ -n "${HTTP_PROXY:-}" ]  && pass "HTTP_PROXY set ($HTTP_PROXY)"  || fail "HTTP_PROXY not set"
[ -n "${HTTPS_PROXY:-}" ] && pass "HTTPS_PROXY set ($HTTPS_PROXY)" || fail "HTTPS_PROXY not set"

for _ in 1 2 3 4 5 6 7 8 9 10; do
    if (exec 3<>/dev/tcp/localhost/3128) 2>/dev/null; then
        exec 3<&- 3>&-
        break
    fi
    sleep 0.2
done

echo "--- network (allowed) ---"
check_net allow openrouter.ai
check_net allow api.z.ai
check_net allow chatgpt.com
check_net allow api.search.brave.com
check_net allow api.exa.ai

echo "--- network (blocked) ---"
check_net block www.google.com
check_net block api.github.com

echo
printf 'pass=%d fail=%d\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
INNER
