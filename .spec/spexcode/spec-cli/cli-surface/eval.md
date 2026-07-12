---
scenarios:
  - name: help-journey
    description: >
      Walk the three help layers as a fresh agent would, through the real CLI: (1) `spex help` — the
      map must open with the noun-first grammar, list the six noun drawers and the project verbs, and
      state the shared conventions (SEL · `.` · --json · --api routing · mentions) once; (2)
      `spex help session` and `spex session wait --help` — a drawer's usage with its caveats (watch
      never exits; send --keys marked last-resort/unstable) and the map/guide footer; (3)
      `spex guide eval` — the skill page must footer back to the help layers. Also probe the
      dead-ends: `spex nosuch`, `spex help nosuch`, `spex guide nosuch`, bare `spex internal`, and an
      unknown drawer verb (`spex spec nosuch`) must each fail loud AND name the layer to return to;
      `spex session new --help` must print help without creating a session.
    expected: >
      Every probe answers with the right layer and a pointer onward — no output that strands the
      reader, no side effect from a --help probe, and no machine-plumbing verb (internal trunk /
      check-staged / session-state / nudge / codex-launch) on the `spex help` map.
    tags: [cli]
    code: [spec-cli/src/help.ts, spec-cli/src/cli.ts]
    related: [spec-cli/src/guide.ts]
  - name: plumbing-not-top-level
    description: >
      The machine tokens must be gone from the porcelain top level: `spex trunk`, `spex
      codex-launch`, `spex codex-turn`, `spex propose` each exit non-zero as unknown commands, while
      `spex internal trunk` prints the resolved trunk branch, `spex internal commit-gate` runs the
      deterministic commit check, and the pre-commit template resolves the trunk through
      `spex_cli internal trunk` (with its pure-git fallback intact for stale hooks) and shims lint
      through `spex_cli spec lint` + `spex_cli internal check-staged`.
    expected: >
      Old top-level tokens are unknown (exit 2, pointing at `spex help`); `spex internal trunk`
      prints the trunk; the installed hooks call only new spellings.
    tags: [cli]
    code: [spec-cli/src/cli.ts]
    related: [spec-cli/src/harness.ts, spec-cli/templates/hooks/pre-commit]
  - name: noun-grammar-signposts
    description: >
      The v0.3.0 noun-first surface, through the real CLI: (1) bare nouns print their drawer help and
      exit 0 (`spex spec`, `spex eval`, `spex session`); (2) each new spelling actually runs
      (`spex spec lint`, `spex graph --focus <id>`, `spex eval lint --changed`, `spex eval ls
      <node>`, `spex issue ls`, `spex evidence put -`, `spex internal commit-gate`); (3) every
      REMOVED spelling signposts — one stderr line naming the replacement, non-zero exit, verb never
      executed: bare `lint`/`tree`/`board`/`new`/`ls`/`watch`/`wait`/`review`/`merge`/`send`,
      `blob …`, `issues …`, `forge …`, `dashboard`, `resolve`/`retract`,
      `session rawkey`, `session state`, `doctor contract`. The `yatsu` tombstone was retired EARLY
      by human ruling (ahead of its 0.4.0 schedule): `yatsu …` now exits 2 as a plain unknown
      command pointing at `spex help` — no replacement line. A signposted verb must produce no side
      effect (e.g. `spex board` writes no JSON to stdout).
    expected: >
      Bare nouns = drawer help (exit 0); new spellings behave; removed spellings exit 2 with a
      one-line signpost naming the new spelling and never execute the old verb; `yatsu` (tombstone
      retired early) exits 2 as a plain unknown command with the `spex help` pointer.
    tags: [cli]
    code: [spec-cli/src/cli.ts, spec-cli/src/help.ts]
---

Measure through the real CLI binary (`node spec-cli/bin/spex.mjs …`), never by reading help.ts: run
each probe, capture stdout/stderr + exit codes as the transcript, and file with `--result`.
