#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── helpers ────────────────────────────────────────────────────────────────

info()    { printf '\033[0;34m[+]\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m[✓]\033[0m %s\n' "$*"; }
warn()    { printf '\033[0;33m[!]\033[0m %s\n' "$*"; }

is_steamos() { grep -q "^ID=steamos" /etc/os-release 2>/dev/null; }
is_mac()     { [ "$(uname -s)" = "Darwin" ]; }
is_wsl()     { grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease 2>/dev/null; }

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
# srt uses OS-native sandboxing: macOS sandbox-exec needs no external deps,
# Linux needs bubblewrap + socat (+ optional seccomp, staged below).
if ! is_mac; then
    command -v bwrap &>/dev/null || pkg_install bubblewrap
    command -v socat &>/dev/null || pkg_install socat
fi

# -- pi binary -------------------------------------------------------------

# Track latest pi, but only (re)install when the installed version differs from
# the target -- a bare `npm install -g @latest` rewrites the whole tree every
# run. To pin, set PI_VERSION to a version string (e.g. "0.79.10").
PI_PKG="@earendil-works/pi-coding-agent"
PI_VERSION="latest"

pi_pkgjson="$(npm root -g 2>/dev/null)/${PI_PKG}/package.json"
pi_current="$(grep -m1 '^[[:space:]]*"version"' "$pi_pkgjson" 2>/dev/null | cut -d'"' -f4)"
if [ "$PI_VERSION" = "latest" ]; then
    pi_target="$(npm view "$PI_PKG" version 2>/dev/null || echo "")"
else
    pi_target="$PI_VERSION"
fi

# Skip when already on target, or when the target can't be resolved (offline)
# but something is installed -- never churn needlessly.
if [ -n "$pi_current" ] && { [ "$pi_current" = "$pi_target" ] || [ -z "$pi_target" ]; }; then
    info "pi already at ${pi_current}, skipping."
else
    info "Installing pi (${pi_target:-$PI_VERSION})..."
    npm uninstall -g @mariozechner/pi-coding-agent 2>/dev/null || true  # retired name
    npm install -g "${PI_PKG}@${PI_VERSION}"
fi
# pi's wrapper at ~/.local/bin/pi wins by PATH order; npm's own pi shim must stay
# so srt can exec `pi` inside the sandbox -- do not remove it.

# srt installs under the active fnm node. Projects that pin a different node
# (.node-version) get a PATH without srt, so the pi launchers fail with
# "command not found: srt". Install under the active node, then symlink into
# ~/.local/bin (always on PATH) so srt resolves regardless of the pane's node.
srt_bin="$(npm prefix -g 2>/dev/null)/bin/srt"
if [ ! -e "$srt_bin" ]; then
    info "Installing srt..."
    npm install -g @anthropic-ai/sandbox-runtime
    srt_bin="$(npm prefix -g 2>/dev/null)/bin/srt"
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$srt_bin" "$HOME/.local/bin/srt"

# srt's apply-seccomp lives under $HOME in the npm package, but srt.json
# denies reads on ~. Stage a copy outside ~ so srt finds it in the sandbox.
# seccomp is Linux-only; macOS srt uses sandbox-exec and ignores it.
if ! is_mac && [ ! -x /usr/local/bin/apply-seccomp ]; then
    srt_root="$(npm root -g 2>/dev/null)/@anthropic-ai/sandbox-runtime"
    srt_seccomp="$srt_root/vendor/seccomp/x64/apply-seccomp"
    if [ -x "$srt_seccomp" ]; then
        info "Staging apply-seccomp..."
        sudo install -m 755 "$srt_seccomp" /usr/local/bin/apply-seccomp
    else
        warn "apply-seccomp not found at $srt_seccomp; sandbox will fail until staged manually."
    fi
fi

# Seed the extension prefix directly. `pi install` runs through the srt
# sandbox, whose allowlist excludes registry.npmjs.org -- it would 403. So
# install with raw npm outside the sandbox, guarded on actual presence.
PI_NPM_PREFIX="$HOME/.pi/agent/npm"
if [ ! -d "$PI_NPM_PREFIX/node_modules/pi-web-providers" ]; then
    info "Installing pi-web-providers..."
    mkdir -p "$PI_NPM_PREFIX"
    npm install pi-web-providers --prefix "$PI_NPM_PREFIX"
fi

# -- docker proxy ----------------------------------------------------------

if command -v docker &>/dev/null && command -v go &>/dev/null; then
    if ! command -v socket-proxy &>/dev/null; then
        info "Installing socket-proxy (Docker API filter)..."
        GOBIN="$HOME/.local/bin" go install github.com/mp-pinheiro/socket-proxy/cmd/socket-proxy@latest
    fi
fi

# -- config ----------------------------------------------------------------

mkdir -p "$HOME/.pi/agent" "$HOME/.pi/sessions" "$HOME/.pi/skills" "$HOME/.pi/local"
cp -R "$REPO_DIR/config/." "$HOME/.pi/agent/"
cp "$REPO_DIR/config/srt.json" "$HOME/.pi/srt.json"
rm -f "$HOME/.pi/agent/srt.json"
cp -R "$REPO_DIR/skills/." "$HOME/.pi/skills/"

if [ -d "$HOME/.pi/local" ] && [ "$(ls -A "$HOME/.pi/local" 2>/dev/null)" ]; then
    info "Applying user overrides from ~/.pi/local/..."
    cp -R "$HOME/.pi/local/." "$HOME/.pi/agent/"
fi

# -- scripts ---------------------------------------------------------------

mkdir -p "$HOME/.local/bin"
ln -sf "$REPO_DIR/scripts/lib-docker-proxy.sh" "$HOME/.pi/lib-docker-proxy.sh"
ln -sf "$REPO_DIR/scripts/pi-sb.sh" "$HOME/.local/bin/pi"
ln -sf "$REPO_DIR/scripts/pi-nosb.sh" "$HOME/.local/bin/pi-nosb"
ln -sf "$REPO_DIR/scripts/pi-sb-validate.sh" "$HOME/.local/bin/pi-sb-validate"
ln -sf "$REPO_DIR/scripts/pi-sb-debug.sh" "$HOME/.local/bin/pi-sb-debug"

# -- done ------------------------------------------------------------------

if ! grep -q 'llm\.pi' /etc/hosts 2>/dev/null; then
    info "Adding llm.pi to /etc/hosts (for local LLM sandbox access)..."
    echo "127.0.0.1 llm.pi" | sudo tee -a /etc/hosts >/dev/null
fi

if ! grep -q 'dev\.pi' /etc/hosts 2>/dev/null; then
    info "Adding dev.pi to /etc/hosts (for sandbox access to host services)..."
    echo "127.0.0.1 dev.pi" | sudo tee -a /etc/hosts >/dev/null
fi

# WSL regenerates /etc/hosts on every restart, wiping the entries above -- which
# breaks llm.pi resolution inside the srt sandbox and forces a re-bootstrap each
# boot. Freeze the file so they persist (this switch is documented in WSL's own
# /etc/hosts header). Needs a one-time `wsl --shutdown` to take effect.
if is_wsl && ! grep -q 'generateHosts' /etc/wsl.conf 2>/dev/null; then
    info "Disabling WSL /etc/hosts regeneration so llm.pi/dev.pi persist across restarts..."
    printf '\n[network]\ngenerateHosts = false\n' | sudo tee -a /etc/wsl.conf >/dev/null
    warn "Run 'wsl --shutdown' from Windows once to apply (WSL reads wsl.conf at boot)."
fi

if [ ! -f "$HOME/.zsh_secrets" ]; then
    warn "~/.zsh_secrets not found. Create it with your API keys (see .zsh_secrets.example)."
fi

success "pi-setup installed."
