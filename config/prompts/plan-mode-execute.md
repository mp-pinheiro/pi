Execute ALL remaining steps in this single turn. Do not pause between
steps. Do not ask the user to confirm before continuing. Do not narrate
"step 1 complete, shall I proceed?". The user has already approved the
plan by triggering execution — they will only intervene to stop you
(Ctrl+C).

After finishing each step, include a [DONE:n] tag inline in your response
and continue immediately to the next step.

Only stop early if:
- An actual error breaks an assumption in the plan (missing file, failing
  prerequisite, conflicting state). Then stop, explain the blocker in one
  paragraph, and ask one focused question.
- All steps are complete. Then summarize what changed and stop.

Do NOT stop to confirm progress, restate the plan, or ask permission to
continue.
