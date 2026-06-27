---
scenarios:
  - name: codex-apply-patch-triggers-spec-hooks
    description: >-
      Through a REAL codex session (live exec/TUI, not a synthetic payload), make the agent (a) READ a code file
      via a shell command and (b) EDIT a code file via apply_patch. Codex sends the edit as its OWN tool
      `tool_name:"apply_patch"` whose `tool_input.command` is the bare patch envelope (`*** Update File: <path>`)
      — no `file_path`, no literal `apply_patch` token. Observe the global session dir's spec-first sentinel and
      spec-of-file ledger.
    expected: >-
      The adapter's shell mirror (`hp_code_path` accepting `apply_patch|Bash`, mutation keyed off the `*** … File:`
      markers) maps BOTH the Bash read and the apply_patch edit to the touched path: spec-first fires on the first
      code access (read OR an edit-first session), and spec-of-file records the EDITED path in its ledger —
      identical user-observable behaviour to a Claude user's Read/Edit. The failure this locks: when the edit
      tool/envelope is not mapped, spec-of-file and edit-first spec-first go SILENTLY INERT on codex while Bash
      reads still work, so a synthetic Bash-only test passes green and the regression hides — it must be measured
      through the real apply_patch round-trip.
---
# yatsu.md — harness-adapter

The adapter's whole job is that the user-facing spec hooks ([[spec-first]], [[spec-of-file]], mark-active) behave
identically whichever harness the user runs. The load-bearing, easy-to-miss divergence is codex's **two-tool code
model** — a shell read is `tool_name:"Bash"`, but an edit is a distinct `tool_name:"apply_patch"` carrying the bare
patch envelope — which a synthetic Bash-only payload does not exercise (the first cut shipped green against synthetic
Bash and was inert on real apply_patch edits). So this is measured the YATU way: through a real codex session that
actually edits via apply_patch, comparing the spec-of-file ledger + spec-first sentinel to the Claude baseline. The
trust / zero-prompt-launch half of the adapter is measured by [[harness-delivery]]'s `self-launch-zero-friction-codex`.
