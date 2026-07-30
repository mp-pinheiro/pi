#!/usr/bin/env bash
# PreToolUse (Bash) guard: enforce Conventional Commits on jj commit/describe/squash messages
# in this jj-managed repo (jj does not run git's commit-msg hook, so this is the enforcement
# point). Exit 2 blocks the tool call and surfaces stderr. Needs jq to read the tool command
# reliably; if jq is absent it fails open (no enforcement) rather than risk false blocks.

command -v jq >/dev/null 2>&1 || exit 0
cmd=$(jq -r '.tool_input.command // .command // empty' 2>/dev/null)
[ -n "$cmd" ] || exit 0

# Only guard jj commit / describe / squash that carry an inline message (-m/--message).
printf '%s' "$cmd" | grep -Eq 'jj[[:space:]]+(commit|describe|squash)([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -Eq '(-m|--message)([[:space:]=])' || exit 0

# Conventional Commits: type(optional scope)(optional !): <space> subject
conv='(-m|--message)[[:space:]=]+["'"'"']?(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:[[:space:]]'
if ! printf '%s' "$cmd" | grep -Eq "$conv"; then
  echo "BLOCKED: commit message must follow Conventional Commits — 'type(scope): subject'. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert (append ! for a breaking change). Example: jj commit -m 'feat(auth): add login'." >&2
  exit 2
fi
exit 0
