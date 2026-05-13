---
description: Audit and clean long-term memory for relevance, correctness, and contradictions
---

Run a memory hygiene pass for this project.

Goals:
1. Keep only durable, high-signal memories.
2. Remove stale or contradictory memories.
3. Preserve user preferences, corrections, and stable project conventions.

Process:
1. Call `memory_stats` and summarize the current state.
2. Call `memory_search` for likely stale/duplicated topics (tooling choices, framework decisions, repo conventions).
3. Call `memory_lessons` and identify:
   - obsolete lessons,
   - duplicates,
   - lessons that conflict with current repo reality.
4. For each stale/conflicting entry, call `memory_forget`.
5. If key durable context is missing, call `memory_remember` with concise facts.
6. End with a short report:
   - removed entries,
   - added entries,
   - unresolved ambiguities requiring user confirmation.

Rules:
- Memory is context, not authority; current file/tool evidence wins.
- Prefer concise, reusable statements over verbose logs.
- Do not store secrets, tokens, or credentials.
