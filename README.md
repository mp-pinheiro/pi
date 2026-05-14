# pi-setup

Opinionated [pi.dev](https://pi.dev) coding agent configuration with sandbox, long-term memory, plan mode, and multi-provider model routing.

## What you get

- **Sandbox** (`pi-sb`): bubblewrap-based filesystem/network isolation via [srt](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime). Agent can only see the current directory and `~/.pi/` -- no `~/.ssh`, no secrets, no arbitrary network.
- **Memory**: vendored SQLite-backed long-term memory (forked from `@samfp/pi-memory`). Cross-session recall with FTS search and automatic consolidation.
- **Plan mode**: read-only investigation phase, then confirmed execution with progress tracking.
- **Multi-provider models**: z.ai (GLM-5.1), OpenAI (GPT-5.3 Codex), OpenRouter (Claude, Kimi K2, Gemini), local llama.cpp (Qwen). All resolved from env vars at runtime.
- **Extensions**: status bar, `/cost`, `/effort`, `/clear`, questionnaire tool, plan mode.
- **Skills**: commit (atomic, style-mimicking), docs (codebase documentation updater), cleanup (AI artifact removal), explore (codebase exploration).

## Prerequisites

- Linux (Debian/Ubuntu) or WSL
- Node.js + npm
- curl

## Install

```sh
git clone https://github.com/YOUR_USER/pi-setup.git
cd pi-setup
./install.sh
```

The installer is idempotent -- safe to re-run.

## API keys

Add to `~/.zsh_secrets` (or wherever your shell sources secrets):

```sh
export Z_AI_API_KEY=...          # z.ai subscription (default provider)
export OPENROUTER_API_KEY=...    # OpenRouter (Claude, Kimi, Gemini)
export EXA_API_KEY=...           # Exa (web search)
export BRAVE_API_KEY=...         # Brave Search (web tools, legacy)
```

## Shell wrapper

Add to `~/.zshrc`:

```zsh
pi() {
    (
        set -a
        source "$HOME/.zsh_secrets"
        set +a
        exec srt --settings "$HOME/.pi/srt.json" pi "$@"
    )
}

pi-nosb() {
    (
        set -a
        source "$HOME/.zsh_secrets"
        set +a
        command pi "$@"
    )
}
```

`pi` runs sandboxed by default. `pi-nosb` bypasses the sandbox for full host access.

## Usage

```sh
pi                  # sandboxed (default)
pi-nosb             # unsandboxed (full host access)
pi-sb-validate      # verify sandbox policy is working
pi-sb-debug         # diagnostic dump inside sandbox
```

## What gets installed where

| Source | Destination |
|--------|-------------|
| `config/` | `~/.pi/agent/` |
| `skills/` | `~/.pi/skills/` |
| `scripts/pi-sb*.sh` | `~/.local/bin/` (symlinks) |

## Models

Configured in `config/models.json`. Four providers:

| Provider | Models | Auth |
|----------|--------|------|
| z.ai | GLM-5.1 (default), GLM-5-Turbo | `Z_AI_API_KEY` |
| OpenAI Codex | GPT-5.3 Codex, GPT-5.1 Codex Max | ChatGPT subscription |
| OpenRouter | Claude Opus/Sonnet 4.6, Kimi K2, Gemini 3 Flash | `OPENROUTER_API_KEY` |
| llama (local) | Qwen 9B (fast), Qwen 35B (smart) | local |

Switch models in-session with `/model`.
