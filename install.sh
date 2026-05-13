#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── helpers ────────────────────────────────────────────────────────────────

info()    { printf '\033[0;34m[+]\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m[✓]\033[0m %s\n' "$*"; }
warn()    { printf '\033[0;33m[!]\033[0m %s\n' "$*"; }

is_steamos() { grep -q "^ID=steamos" /etc/os-release 2>/dev/null; }

pkg_install() {
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y -qq "$1"
    elif command -v brew &>/dev/null; then
        brew install "$1"
    else
        warn "No supported package manager found. Install '$1' manually."
        return 1
    fi
}

# ── main ───────────────────────────────────────────────────────────────────

if is_steamos; then
    info "pi: not supported on SteamOS, skipping."
    exit 0
fi

# -- dependencies ----------------------------------------------------------

command -v bwrap &>/dev/null || pkg_install bubblewrap
command -v socat &>/dev/null || pkg_install socat

# -- pi binary -------------------------------------------------------------

if ! command -v pi &>/dev/null; then
    info "Installing pi..."
    curl -fsSL https://pi.dev/install.sh | sh
fi

if ! command -v srt &>/dev/null; then
    info "Installing srt..."
    npm install -g @anthropic-ai/sandbox-runtime
fi

# srt's apply-seccomp lives under $HOME in the npm package, but srt.json
# denies reads on ~. Stage a copy outside ~ so srt finds it in the sandbox.
if [ ! -x /usr/local/bin/apply-seccomp ]; then
    srt_root="$(npm root -g 2>/dev/null)/@anthropic-ai/sandbox-runtime"
    srt_seccomp="$srt_root/vendor/seccomp/x64/apply-seccomp"
    if [ -x "$srt_seccomp" ]; then
        info "Staging apply-seccomp..."
        sudo install -m 755 "$srt_seccomp" /usr/local/bin/apply-seccomp
    else
        warn "apply-seccomp not found at $srt_seccomp; sandbox will fail until staged manually."
    fi
fi

if ! pi list 2>/dev/null | grep -q "pi-web-providers"; then
    info "Installing pi-web-providers..."
    pi install npm:pi-web-providers
fi

# -- config ----------------------------------------------------------------

mkdir -p "$HOME/.pi/agent" "$HOME/.pi/sessions" "$HOME/.pi/skills"
cp -R "$REPO_DIR/config/." "$HOME/.pi/agent/"
cp -R "$REPO_DIR/skills/." "$HOME/.pi/skills/"

# -- scripts ---------------------------------------------------------------

mkdir -p "$HOME/.local/bin"
ln -sf "$REPO_DIR/scripts/pi-sb.sh" "$HOME/.local/bin/pi-sb"
ln -sf "$REPO_DIR/scripts/pi-nosb.sh" "$HOME/.local/bin/pi-nosb"
ln -sf "$REPO_DIR/scripts/pi-sb-validate.sh" "$HOME/.local/bin/pi-sb-validate"
ln -sf "$REPO_DIR/scripts/pi-sb-debug.sh" "$HOME/.local/bin/pi-sb-debug"

# -- done ------------------------------------------------------------------

bash "$REPO_DIR/scripts/setup-secrets.sh"

success "pi-setup installed."
