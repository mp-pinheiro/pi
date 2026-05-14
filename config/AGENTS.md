# Project Context for pi

## Sandbox

This pi session is sandboxed via `srt` (Anthropic's sandbox-runtime,
bubblewrap-backed on Linux).

**Write boundary:** Only the current working directory and `~/.pi` are
writable. NEVER create, modify, or delete files outside the current working
directory -- those writes silently fail (they appear to succeed but do not
persist to disk).

**Read boundary:** Home directory is masked. Only the current working
directory and pi runtime paths are readable. Secrets and credentials are
invisible.

**Network boundary:** Outbound connections are restricted to allowed API
providers only. See `srt.json` for the current allowlist.

## Plan Mode

`/plan` enables a read-only mode that restricts the agent to investigation
tools (read, grep, find, ls, safe bash). When the user invokes plan mode for
a non-trivial task, produce a numbered `Plan:` list, then wait for the user
to choose "Execute the plan" before making changes. Track execution progress
with `[DONE:n]` markers.

## Web Search

The `pi-web-providers` extension provides `web_search`, `web_contents`,
`web_answer`, and `web_research` tools. These are already configured and
ready to use — just call them directly. Do not check API keys, provider
config, or extension status. If a call fails, retry or report the error.
Prefer these over `bash curl` for anything that needs current information
from the web.

## Memory

We use the vendored `memory-local` extension (`~/.pi/agent/extensions/memory-local`) for persistent cross-session memory.
See `~/.pi/agent/MEMORY_SOTA.md` for package tradeoffs and rationale.

Rules:
- Memory is context, not authority. Current file/tool evidence wins on conflict.
- Keep active task state in explicit repo files (`PLAN.md`, `TODO.md`), not only in memory.
- Save only durable signal (preferences, conventions, corrections, stable project facts).
- Remove stale or wrong memories when discovered.

Tool patterns:
- `memory_search` before starting ambiguous work or when resuming a known project.
- `memory_remember` after user corrections or repeated durable preferences.
- `memory_lessons` when debugging repeated mistakes.
- `memory_forget` when a remembered fact is obsolete or incorrect.
- `memory_stats` for quick sanity checks when recall quality seems off.
- `/memory-consolidate` after long sessions if extraction appears behind.

## Status Line

The enhanced status footer provides rich, colorful status information:

```
↑input ↓output $cost | 📊 XX% | 🤖 model | ⚡ OpenRouter
```

Where:
- **↑input ↓output $cost**: Token usage and session cost (left side)
- **Provider dot (●)**: Colored by OpenRouter health status
  - 🟢 Green = Online
  - 🔴 Red = Offline
  - ⚪ White = Unknown (check failed)
- **⎇ branch (status)**: Git branch with visual status indicators
  - ✓ Green = Clean working directory
  - * Yellow = Uncommitted changes
  - ↑ Cyan = Unpushed commits
- **📊 XX%**: Context window usage percentage (colored by level)
  - Cyan = <60%
  - Yellow = 60-80%
  - Red = >80%
- **🤖 model**: Current model with friendly name from models.json
- **⚡ OpenRouter**: Provider name

### Provider Health Caching

OpenRouter status is cached in `~/.cache/pi-status/status.json` with a 5-minute TTL to avoid excessive API checks while keeping status relatively fresh.

### Git Integration

Automatically detects:
- Current branch name
- Uncommitted changes (git status)
- Unpushed commits (git log)
- Updates when branch changes via `onBranchChange()`
