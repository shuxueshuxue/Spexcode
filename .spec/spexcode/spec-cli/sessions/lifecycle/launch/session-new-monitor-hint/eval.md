---
scenarios:
  - name: session-verb-help-is-specific
    tags: [cli]
    test: spec-cli/src/session-help-cli.test.ts
    description: >
      Through the real CLI, run `spex session send --help`, `spex session wait --help`, and
      `spex session new --help`, capturing stdout, stderr, and exit codes. Compare each with the bare
      `spex session` drawer and with the other verb probes.
    expected: >
      Every probe exits 0 without running its verb and prints only that verb's exact usage/behaviour from
      the shared session help definition, not the repeated full drawer. Send keeps plain text plus unstable
      last-resort raw keys, wait keeps its edge-triggered exit semantics, new explains launch inputs, and
      selector/write entries keep the shared SEL grammar/project-bound safety notes. Every entry points back
      to the help map/guide without prescribing an orchestration workflow. Bare `spex session` remains the
      complete compatible drawer.
    code: spec-cli/src/help.ts
    related: spec-cli/src/cli.ts
  - name: hint-names-monitor-and-comm
    tags: [cli]
    test:
      path: spec-cli/src/session-create-cli.test.ts
      name: session new keeps exact JSON stdout and emits the dependency receipt on stderr
    description: >
      Launch a real session with `spex session new`, capturing stdout and stderr separately. Check the stderr
      receipt printed after the create: it must carry the new session id and the three dependency labels
      (current result, next lifecycle change, response channel). The lifecycle line must name background
      `spex session wait <id>` with its edge-triggered exit and `spex session watch <id>` as a stream that
      never exits. The response line must name `spex session send <id> "<msg>"` and keep raw keys behind a
      plain-send-first last-resort warning. Check stdout in the same run: it must be exactly the parseable
      session JSON, untouched by the receipt.
    expected: |
      Stderr carries one concise, caller-independent dependency model: current result, next lifecycle
      change, and response channel. It preserves wait's edge-triggered wake-up, watch's never-exit stream,
      ordinary send, and raw keys as an unstable last resort. Stdout parses as the bare session JSON with
      no receipt text mixed in.
    code: spec-cli/src/help.ts
    related: spec-cli/src/cli.ts
---

# session-new-monitor-hint — yatsu

Measure through the real CLI, never by reading `help.ts`: verb probes prove the pre-dispatch projection, and
a real `spex session new` proves the two streams a caller actually receives. The loss is whether the caller
can discover one exact verb and can leave a successful create with the three dependencies without corrupting
machine-readable stdout.
