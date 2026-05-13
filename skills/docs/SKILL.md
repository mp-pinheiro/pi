---
allowed-tools: Bash(rg:*), Bash(git:*), Glob, Grep, Read, mcp__repomix__pack_codebase, mcp__repomix__attach_packed_output, mcp__repomix__read_repomix_output, mcp__repomix__grep_repomix_output, mcp__repomix__file_system_read_file, mcp__repomix__file_system_read_directory, Write, Edit
description: Update codebase documentation to reflect current code state
---

## Purpose

Analyze code changes and update all relevant documentation to reflect the current state of the codebase.

## Parameters

| Parameter | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| scope     | string | No       | Brief description of what changes were made (e.g., "added authentication", "refactored payment flow") |

Store the scope description for use in LLM queries and final output.

## Execution Flow

### Pass 0: Check for existing doc update

Grep conversation history for documentation update patterns. If docs were just updated, skip with message: "Documentation recently updated, skipping."

### Pass 1: Discover changes

Run `git log --oneline -10` and `git diff --name-only HEAD~5` to find recent changes.

If no changes found:

- Prompt user: "No recent changes detected. Describe what to document (or 'abort'):"
- Accept description or 'abort'

### Pass 2: Pack codebase for analysis

Run `mcp__repomix__pack_codebase` to repository root.

Standard exclusions (ignorePatterns):

- `node_modules/**`, `dist/**`, `build/**`, `.git/**`, `vendor/**`, `target/**`, `*.test.*`, `*.spec.*`

Output to scratchpad directory.

### Pass 3: Analyze and update documentation

#### Discover documentation files

Find all documentation files:

```bash
rg --files -g 'README*' -g 'CHANGELOG*' -g 'CONTRIBUTING*' -g '*.md' --no-ignore -g '!node_modules'
```

#### Analyze code changes

Query the codebase pack with scope context:
"Analyze recent code changes for: **{scope}**. Identify:
1. What functionality was added, removed, or changed
2. New APIs, configuration options, or environment variables
3. Breaking changes or migration requirements
4. Updated deployment or usage instructions"

#### Update documentation files

For each relevant doc file:

1. **README.md**: Update feature descriptions, setup instructions, examples
2. **CHANGELOG.md**: Add entry for new changes (if exists)
3. **API docs**: Update interface descriptions, parameters, return values
4. **Deployment docs**: Update env vars, config options, deployment steps
5. **Contributing docs**: Update development setup, conventions

Use `Edit` or `Write` tool to make changes.

### Pass 4: Present changes and confirm

Display changes made:

```
Documentation updates for: {scope}

Files modified:
  README.md - Updated setup instructions with new env vars
  docs/API.md - Added new endpoint documentation
  deploy/DEPLOYMENT.md - Updated deployment steps

Summary:
  - Added documentation for TRANSACTION_CODE env var
  - Updated examples to show new authentication flow
  - Added migration guide for breaking changes

Review changes? (y/n) or 'abort' to cancel
```

Read user input. If 'y' or empty, proceed. If 'n', allow manual edits. If 'abort', revert changes.

### Pass 5: Commit changes

Stage and commit documentation updates:

```bash
git add docs/ README.md CHANGELOG.md
git commit -m "docs: update for {scope}"
```

Report: "Documentation updated and committed for: {scope}"

## Documentation File Patterns

| Pattern              | Type           | Update Strategy                                    |
| -------------------- | -------------- | --------------------------------------------------- |
| README*              | Overview        | Feature list, setup, examples                      |
| CHANGELOG*           | Changelog       | Add new entry with date and changes                 |
| CONTRIBUTING*        | Developer guide | Setup, conventions, PR guidelines                  |
| docs/**/*.md         | Detailed docs   | API reference, architecture, guides                 |
| deploy/**/*.md       | Deployment      | Env vars, config, deployment steps                 |
| .env.example         | Config template | Add new environment variables with example values |

## Edge Cases

1. **No documentation files:** Create README.md if none exists
2. **Large changes:** Split into multiple documentation updates
3. **Breaking changes:** Highlight prominently in docs
4. **New features:** Add usage examples

## Exit Conditions

- Success: Documentation updated and committed, report summary
- Skipped: Recent docs update detected or user aborted
- Error: Unable to analyze changes or write files (report stderr)