# Plan Mode Extension

Read-only exploration mode with persistent plan files.

## Commands

- `/plan` — Toggle plan mode (also `Ctrl+\`)
- `--plan` flag — Start session in plan mode

## Workflow

1. Enter plan mode (`/plan`)
2. Agent investigates the codebase using read-only tools
3. Agent writes a plan file to `.pi/plans/plan-<timestamp>.md`
4. User chooses: **Execute** / **Refine** / **Stay**
5. On execute: full tools restored, agent reads plan file and implements

## Plan Files

Plans are written to `<project>/.pi/plans/` as Markdown with three sections:
- **Context** — why the change is needed
- **Steps** — concrete numbered implementation actions
- **Verification** — commands to confirm success

## Bash in Plan Mode

Uses a **blocklist** approach — any command is allowed unless it's destructive:

**Blocked:**
- File mutation: `rm`, `mv`, `cp`, `mkdir`, `touch`, `chmod`, `tee`, `>`, `>>`
- Package install: `npm install`, `yarn add`, `pip install`, `apt install`, `brew install`
- Git write: `git add`, `git commit`, `git push`, `git reset`, `git rebase`
- System: `sudo`, `kill`, `reboot`, `systemctl start/stop/restart`
- Editors: `vim`, `nano`, `code`
- Container/infra: `docker rm/stop/kill`, `kubectl delete/apply/create`

**Allowed (everything else):**
- `objdump`, `rizin`, `readelf`, `nm`, `strings`, `hexdump`, `xxd`
- `python -c`, `node -e`, `cargo --version`, `go version`
- `curl` (GET only), `wget`, `jq`, `rg`, `fd`, `bat`
- `git log`, `git diff`, `git show`, `git status`, `git branch`
- All standard Unix read commands

## State Machine

```
NORMAL → /plan → PLANNING → (plan file written) → REVIEWING → Execute → EXECUTING → NORMAL
                    ↑              |                              |
                    |              ← Stay / Cancel                |
                    |                                             |
                    ← ────────── /plan (abort) ──────────────────←
```

## Session Persistence

State is persisted via `pi.appendEntry()` on every transition. On resume:
- State and plan file path are restored
- If the plan file no longer exists on disk, state resets to normal
- Tool restrictions are re-applied if still in planning
