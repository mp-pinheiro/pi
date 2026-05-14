# Pi memory system: SOTA + implementation decision (2026-05-11)

## Executive summary

- **Pi core today** gives strong **short-/mid-term continuity** via session history, compaction, and branch summarization, but no built-in durable cross-session memory layer.
- In the Pi package ecosystem, the best base for this repo is **`@samfp/pi-memory`** (focused, low-ops, SQLite-backed, selective injection support).
- If you want a wider context stack later, move to **`pi-total-recall`** (wraps memory + session search + knowledge search).
- Creator guidance from Mario Zechner strongly favors **minimal core, explicit file state, progressive disclosure, and avoiding heavy built-ins**; this matches a lightweight memory extension + file-based task state.

---

## 1) Pi-native baseline (what you already have)

Pi core already includes:
- **Session persistence + branching**
- **Compaction summaries** (`/compact`)
- **Branch summaries** (`/tree` navigation)

This is documented in Pi’s compaction docs:
- https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/compaction.md

Interpretation: this is excellent for **in-session / branch continuity**, but it is not a full long-term semantic memory system by itself.

---

## 2) Pi package landscape (memory-focused)

### `@samfp/pi-memory` (selected baseline)
- Positioning: persistent memory for preferences/corrections/project patterns.
- Tools: `memory_search`, `memory_remember`, `memory_forget`, `memory_lessons`, `memory_stats`.
- Notable: **`memory.lessonInjection = "selective"`** mode.
- Storage: SQLite (`~/.pi/memory/memory.db`).
- Package page: https://pi.dev/packages/@samfp/pi-memory

### `pi-total-recall` (bundle option)
- Bundles `@samfp/pi-memory` + `pi-session-search` + `pi-knowledge-search`.
- Good if you want one install for memory + historical sessions + local KB search.
- Package page: https://pi.dev/packages/pi-total-recall

### `pi-hermes-memory`
- Broader system: policy-only prompt mode, memory categories, session search, skill capture, secret scanning.
- More features and moving parts.
- Package page: https://pi.dev/packages/pi-hermes-memory

### `pi-agent-memory`
- Adapter to `claude-mem` worker (cross-engine shared memory, hybrid search).
- Requires external worker/runtime assumptions.
- Package page: https://pi.dev/packages/pi-agent-memory

### `pi-mem` / `pi-memory` / `@zhafron/pi-memory`
- Viable alternatives with different tradeoffs (vector DB, markdown-first workflows, identity/profile patterns, qmd integration, etc.).

---

## 3) Broader industry SOTA signals

### Research references
- **A-MEM** (NeurIPS 2025): dynamic linking + evolving notes for agentic memory.
  - https://arxiv.org/abs/2502.12110
- **Mem0**: production-oriented long-term memory with extraction/consolidation/retrieval, graph variant.
  - https://arxiv.org/abs/2504.19413
- **Memory in the Age of AI Agents** (survey): memory forms/functions/dynamics taxonomy.
  - https://arxiv.org/abs/2512.13564

### Open-source adoption signals (GitHub, checked 2026-05-11)
- `thedotmack/claude-mem`: 74k+ stars
- `mem0ai/mem0`: 55k+ stars
- `getzep/graphiti`: 25k+ stars
- `letta-ai/letta`: 22k+ stars

Interpretation: the field converges on a few repeated patterns:
1. Event capture from agent/tool traces
2. Consolidation into durable facts/lessons
3. Hybrid retrieval (lexical + semantic)
4. Bounded, selective context injection
5. Memory as **advisory context**, not authority

---

## 4) Creator guidance (Mario Zechner) relevant to memory design

From:
- https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/

Key principles that matter here:
- Keep the harness **minimal and explicit**.
- Prefer **file-based, inspectable state** (e.g., TODO/PLAN files) for active workflow control.
- Use progressive disclosure; avoid large always-on context overhead.
- Favor composable, practical tooling over heavyweight abstractions.

Implication: use a lightweight memory extension for durable recall, but keep active execution state in repo files.

---

## 5) Decision for this dotfiles repo

Default stack in this repo:
1. `pi-web-providers` (existing)
2. vendored `memory-local` extension in `config/extensions/memory-local` (forked from `@samfp/pi-memory`)
3. tuned memory config in `config/settings.json`:
   - `lessonInjection: "selective"`
   - `consolidateOnSwitch: false`
   - `consolidateOnShutdown: true`
   - `consolidationModel: "zai/glm-5-turbo"` (fast, cheap)
   - `consolidationThinking: "off"`
   - `consolidationTimeoutMs: 15000`
   - `consolidationMinUserMessages: 3`
   - `statusClearMs: 1200`

Why:
- Keeps the strong utility of the `@samfp/pi-memory` design.
- Removes long/sticky consolidation UX issues by patching behavior locally.
- Aligns with minimal-core philosophy while keeping full control in-repo.

---

## 6) Operating policy

- Treat memory as **fallible context**.
- Filesystem/tool evidence wins on conflicts.
- Store only durable items (preferences, conventions, corrections, stable project facts).
- Keep active plan/checklist state in `PLAN.md` / `TODO.md` in the repo.
- Periodically prune stale memory entries.
