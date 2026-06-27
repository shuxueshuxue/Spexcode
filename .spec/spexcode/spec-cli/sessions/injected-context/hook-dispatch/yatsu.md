---
scenarios:
  - name: dispatch-reproduces-legacy-hooks
    description: >-
      Launch a real session whose hooks run through the dispatcher (the committed shim → dispatch.sh,
      manifest compiled at SessionStart) instead of the legacy hardcoded settingsJson. Drive a full turn:
      submit a prompt, read/edit a non-spec file before opening the node's spec, then try to stop while
      undeclared with uncommitted work. Compare against the legacy path.
    expected: >-
      Behaviorally identical to the legacy wiring: mark-active flips the session to active on the prompt
      and to asking on AskUserQuestion; spec-first blocks ONCE on the first code touch then passes;
      spec-of-file annotates the first edit of a file with its governing node; the stop-gate blocks the
      undeclared/uncommitted stop with the same reason and loop-break; StopFailure→error and
      idle_prompt→idle still fire. The compiled manifest equals the legacy event→script map, and the
      dispatcher runs same-event hooks in `order`, replays stdin to each, and propagates only a block:true
      hook's exit-2.
---
# yatsu.md — hook-dispatch

The dispatch layer is substrate; its loss is measured through the **real session round-trip** (YATU), not a
mocked harness — a session launched on the dispatcher must be indistinguishable from one on the legacy
hooks. Unmeasured until increment 2 wires sessions.ts onto the dispatcher; the data-level equivalence
(manifest == legacy map; dispatcher unit tests) is recorded in HARNESS-REFACTOR-REPORT.md §6.
