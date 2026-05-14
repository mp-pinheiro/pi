# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Read-only tools**: Restricts available tools to read, bash, grep, find, ls, question
- **Bash allowlist**: Only read-only bash commands are allowed
- **Plan extraction**: Extracts numbered steps from `Plan:` sections
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking
- **Session persistence**: State survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show current plan progress
- `Ctrl+\` - Toggle plan mode (shortcut)

## Usage

1. Enable plan mode with `/plan` or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose "Execute the plan" when prompted
5. During execution, the agent marks steps complete with `[DONE:n]` tags
6. Progress widget shows completion status

## How It Works

### Plan Mode (Read-Only)
- Only read-only tools available
- Bash commands filtered through allowlist
- Agent creates a plan without making changes

### Execution Mode
- Full tool access restored
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress

### Command Allowlist

**File inspection:**
- `cat`, `head`, `tail`, `less`, `more`
- `grep`, `rg` (ripgrep), `fd` (fzf find)
- `find`, `ls`, `pwd`, `tree`, `bat`, `eza`

**Text processing:**
- `echo`, `printf`, `wc`, `sort`, `uniq`, `diff`, `file`, `stat`, `du`, `df`
- `sed -n`, `awk` (read-only)

**Search & directory:**
- `which`, `whereis`, `type`, `env`, `printenv`, `uname`, `whoami`, `id`
- `date`, `cal`, `uptime`, `ps`, `htop`, `free`

**Git (read-only):**
- `git status`, `git log`, `git diff`, `git show`, `git branch`
- `git remote`, `git config --get`, `git ls-`

**Package info:**
- `npm list`, `npm ls`, `npm view`, `npm info`, `npm search`, `npm outdated`, `npm audit`
- `yarn list`, `yarn info`, `yarn why`, `yarn audit`

**Runtime:**
- `node --version`, `python --version`

**Limited network:**
- `curl` (GET only, no POST/PUT/PATCH/DELETE, no data upload)
- `wget -O -` (download to stdout)

**JQ & streaming:**
- `jq`, `curl | jq` for JSON parsing

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
