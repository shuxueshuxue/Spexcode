---
scenarios:
  - name: block-message-once
    tags: [cli]
    description: >-
      Trigger the DECLARE gate twice on ONE session (two first-stops: stop_hook_active=false, status still
      active/undeclared): feed stop-gate.sh a real Stop payload against a governed session record, exactly
      as dispatch.sh does, and capture both block reasons.
    expected: >-
      The first block prints the full teaching text — the five-choice menu with each choice's application
      condition, plus the declare-LAST ordering discipline (the declaration is the turn's final call; any
      later tool call honestly re-flips the record to active). Every later undeclared stop in the SAME
      session prints a one-line reason instead, and that line is self-explanatory: it still carries the
      command menu, the declare-LAST reminder, and a recovery entry (spex help session) from which an agent
      that never saw the full text — a compacted context — can rebuild every choice's condition. The full
      text never repeats within a session.
    code: .spec/spexcode/.plugins/prompts/core/stop-gate/stop-gate.sh
    related: spec-cli/templates/spec/project/.plugins/core/stop-gate/stop-gate.sh
---
Measured YATU on the hook surface itself: invoke stop-gate.sh the way dispatch.sh invokes it — the
Stop payload on stdin, SPEXCODE_HARNESS_LIB sourced, the session resolved through hp_store_dir into
a governed session.json — and read the `{"decision":"block"}` reasons the harness would show the
agent. A live confirmation on a real governed session (stop undeclared, read the block feedback,
park on a background task, wake, stop undeclared again) is the same measurement on the same surface.
