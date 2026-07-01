---
scenarios:
  - name: manifest-equals-legacy-map
    tags: [backend-api]
    description: >-
      Compile the surface:hook nodes to the persistent manifest (`spex materialize` / the gate) and compare
      to the legacy event→script map.
    expected: >-
      The manifest is exactly UserPromptSubmit→mark-active; PreToolUse→mark-active(order 10)+spec-first(order
      20, block) in that order; PostToolUse→spec-of-file; Stop→stop-gate(block); StopFailure→session-fail;
      Notification→idle — one line per (node × event), sorted by event then order.
  - name: content-hash-gate-catches-every-edit-source
    tags: [backend-api]
    description: >-
      With artifacts current, change a `.config` file FOUR ways and fire a tool event after each: (a) an
      editor write, (b) a bash `echo >>`, (c) a `sed -i`, (d) adding a new node file. Also `touch` a file
      without changing content.
    expected: >-
      Each of (a)-(d) moves the content hash → the gate re-runs materialize that one time (manifest/contract
      refresh). The bare `touch` does NOT change the content hash → no re-materialize. The gate is pure-shell
      (~10ms) on the unchanged hot path; node boots only on a real change. (A tool-payload-path detector would
      have missed b/c/d — this is why it is content-based.)
  - name: block-decision-passes-through
    tags: [backend-api]
    description: >-
      Drive a PreToolUse event for a session that should be nudged (first code access, spec untouched), so
      spec-first emits its decision. Capture the dispatcher's stdout/exit.
    expected: >-
      The dispatcher passes spec-first's `{"decision":"block","reason":…}` stdout through UNCHANGED (exit 0)
      so the harness blocks — the real blocking hooks use the stdout JSON-decision mechanism, NOT exit 2.
      mark-active still ran (its side effect happened) regardless of spec-first's block — all handlers run.
  - name: gate-concurrent-rerender-is-atomic
    tags: [backend-api]
    description: >-
      Trigger two dispatch invocations concurrently right after a `.config` change (two events at once).
    expected: >-
      Only ONE re-materialize runs (the flock + re-check inside it), no torn manifest/contract; the second
      invocation sees the fresh content-hash and skips. Readers never observe a half-written manifest.
---
# yatsu.md — hook-dispatch

The dispatch layer is measured through the real session round-trip (YATU). Invariants: the persistent
manifest equals the legacy map (so dashboard hooks are unchanged); the content-hash gate is content-based
(catches bash/sed/new-file/editor edits, ignores touch) and cheap on the hot path; real blocking rides the
stdout decision JSON the dispatcher passes through verbatim; concurrent re-renders are atomic. Measure the
manifest by byte-diff; measure the gate by editing `.config` each way and watching for one re-materialize.
