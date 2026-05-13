#!/usr/bin/env bash
# Diagnostic probe inside the pi srt sandbox. Dumps mount table around ~/.pi,
# attempts a write to ~/.pi/sessions, lists listening sockets, and runs
# verbose curl against the in-sandbox HTTP proxy and an allowed domain.

set -u

SRT_SETTINGS="${PI_SRT_SETTINGS:-$HOME/.pi/agent/srt.json}"

if ! command -v srt >/dev/null 2>&1; then
    printf '\033[0;31m[!]\033[0m srt not installed\n' >&2
    exit 127
fi

if [ ! -f "$SRT_SETTINGS" ]; then
    printf '\033[0;31m[!]\033[0m policy not found at %s\n' "$SRT_SETTINGS" >&2
    exit 127
fi

SCRATCH="$(mktemp -d -t pi-sb-debug.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
cd "$SCRATCH"

exec srt --settings "$SRT_SETTINGS" bash <<'INNER'
set -u

section() { printf '\n\033[1;34m=== %s ===\033[0m\n' "$1"; }

section "mount table around ~/.pi"
mount | grep -E "/home/matheus/\.pi|tmpfs.*matheus" || echo "  (no matches)"

section "~/.pi listing on host (via sandbox)"
ls -la "$HOME/.pi/" 2>&1
echo "--- ~/.pi/sessions ---"
ls -la "$HOME/.pi/sessions/" 2>&1 | head -10

section "write probe: ~/.pi/sessions/srt-probe"
touch "$HOME/.pi/sessions/srt-probe" 2>&1
echo "touch exit=$?"
ls -la "$HOME/.pi/sessions/srt-probe" 2>&1
rm -f "$HOME/.pi/sessions/srt-probe" 2>/dev/null

section "listening sockets"
ss -tlnp 2>&1 | head -10 || netstat -tlnp 2>&1 | head -10

section "proxy env"
env | grep -iE '^(http|https|no)_proxy' | sort

section "curl GET https://api.z.ai (via proxy, 15s)"
curl -sS --max-time 15 -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' https://api.z.ai/ 2>&1
echo "exit=$?"

section "curl HEAD https://api.z.ai (via proxy, 15s)"
curl -sS -I --max-time 15 -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' https://api.z.ai/ 2>&1
echo "exit=$?"

section "validator-style: HEAD via function/local/set -u (api.z.ai)"
( set -u
  probe() {
      local domain="$1" code rc
      code=$(curl -sS -I --max-time 20 -o /dev/null -w '%{http_code}' "https://$domain/" 2>/dev/null)
      rc=$?
      echo "  func-call: rc=$rc code=$code"
  }
  probe api.z.ai
  probe openrouter.ai
)

section "back-to-back HEADs from same shell (sequence the validator runs)"
for d in openrouter.ai api.z.ai chatgpt.com api.search.brave.com; do
    code=$(curl -sS -I --max-time 10 -o /dev/null -w '%{http_code}' "https://$d/" 2>/dev/null)
    echo "  $d: rc=$? code=$code"
done

section "curl -v HEAD https://api.z.ai (verbose, 10s)"
curl -sS -v -I --max-time 10 https://api.z.ai/ 2>&1 | head -25

section "curl -v GET https://openrouter.ai (verbose, 10s)"
curl -sS -v --max-time 10 https://openrouter.ai/ 2>&1 | head -25

section "summary"
echo "If you see no rw bind for ~/.pi/sessions, that's bug A."
echo "If ss shows no listener on :3128, socat in the wrapper failed (bug B1)."
echo "If ss shows :3128 but curl can't tunnel, the upstream proxy enforcement is the issue (bug B2)."
INNER
