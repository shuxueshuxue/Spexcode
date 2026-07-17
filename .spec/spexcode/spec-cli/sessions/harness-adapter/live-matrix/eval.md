---
scenarios:
  - name: matrix-run
    tags: [backend-api]
    description: >-
      Run `spex eval matrix <launcher>` end to end against two DIFFERENT real harness launchers (e.g. pi
      and opencode) from a committed HEAD: the same runner code, only the launcher argument varying.
    expected: >-
      Each run drives one real dispatched worker through all eight rows, syncs the target harness node's
      eval.md matrix scenarios onto the shared contract text (historical names kept, non-matrix scenarios
      untouched), files a per-row reading with its evidence transcript, and prints an honest summary
      (skip = unprovoked, never a fabricated verdict). Conclusions agree with the manually-driven wave on
      the same harnesses; covering the second harness required zero new runner code.
---
