#!/usr/bin/env bash
# PreToolUse (Bash) guard: this repo is jj-managed (colocated jj+git, git HEAD detached
# on purpose). Block mutating git so VCS changes always go through jj. See docs/jj-workflow.md.
# Exit 2 blocks the tool call and surfaces stderr to the agent. Read-only git and release
# `git tag`/tag-push stay allowed. Matches the raw hook JSON to avoid a jq/python dependency.
# The `(?<!jj\s)` lookbehind is load-bearing: without it `git push` matches inside `jj git
# push`, blocking the workflow's own push command.

input=$(cat)

if printf '%s' "$input" | grep -Pq '(?<!jj\s)git\s+(commit|add|rebase|merge|reset|restore|switch|checkout|cherry-pick|revert|stash|clean|am|apply)([\s"\\]|$)'; then
  echo "BLOCKED: this repo is jj-managed — use jj, not git, for VCS changes: 'jj commit -m', 'jj tug', 'jj git push' (see docs/jj-workflow.md). Read-only git (log/status/diff/show) and release 'git tag' are fine." >&2
  exit 2
fi

if printf '%s' "$input" | grep -Pq '(?<!jj\s)git\s+push'; then
  if printf '%s' "$input" | grep -Eq '(--tags|[[:space:]]v[0-9])'; then
    exit 0
  fi
  echo "BLOCKED: use 'jj git push', not 'git push', in this jj-managed repo (release tags are the exception: 'git push origin vX.Y.Z'). See docs/jj-workflow.md." >&2
  exit 2
fi

exit 0
