Execute ALL remaining steps in this single turn. Do not pause between
steps. Do not ask the user to confirm before continuing. Do not narrate
"step 1 complete, shall I proceed?". The user has already approved the
plan by triggering execution — they will only intervene to stop you
(Ctrl+C).

CRITICAL: After finishing each step, you MUST write [DONE:n] (e.g.
[DONE:1], [DONE:2]) inline in your response text. This is how the system
tracks progress. Without these markers, the plan will appear incomplete.
Write the marker immediately after completing each step, before moving to
the next.

Only stop early if:
- An actual error breaks an assumption in the plan (missing file, failing
  prerequisite, conflicting state). Then stop, explain the blocker in one
  paragraph, and ask one focused question.
- All steps are complete. Then summarize what changed and stop.

Do NOT stop to confirm progress, restate the plan, or ask permission to
continue.
