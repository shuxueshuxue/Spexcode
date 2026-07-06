---
scenarios:
  - name: help-journey
    description: >
      Walk the three help layers as a fresh agent would, through the real CLI: (1) `spex help` — the
      map must group porcelain by loop, include search and owner, and name both the per-command layer
      and the guide; (2) `spex help wait` and `spex watch --help` — one command's usage with its
      caveats and a see-also plus the map/guide footer; (3) `spex guide yatsu` — the skill page must
      footer back to the help layers. Also probe the dead-ends: `spex nosuch`, `spex help nosuch`,
      `spex guide nosuch`, and bare `spex internal` must each fail loud AND name the layer to return
      to; `spex session new --help` must print help without creating a session.
    expected: >
      Every probe answers with the right layer and a pointer onward — no output that strands the
      reader, no side effect from a --help probe, and no machine-plumbing verb (internal trunk /
      codex-launch / codex-turn) on the `spex help` map.
    tags: [cli]
    code: [spec-cli/src/help.ts, spec-cli/src/cli.ts]
    related: [spec-cli/src/guide.ts]
  - name: plumbing-not-top-level
    description: >
      The old machine tokens must be gone from the porcelain top level: `spex trunk`, `spex
      codex-launch`, `spex codex-turn`, `spex propose` each exit non-zero as unknown commands, while
      `spex internal trunk` prints the resolved trunk branch and the pre-commit template resolves the
      trunk through `spex_cli internal trunk` (with its pure-git fallback intact for stale hooks).
    expected: >
      Old top-level tokens are unknown (exit 2, pointing at `spex help`); `spex internal trunk`
      prints the trunk; the generated codex launch script calls `internal codex-launch`.
    tags: [cli]
    code: [spec-cli/src/cli.ts]
    related: [spec-cli/src/harness.ts, spec-cli/templates/hooks/pre-commit]
---

Measure through the real CLI binary (`tsx spec-cli/src/cli.ts …`), never by reading help.ts: run each
probe, capture stdout/stderr + exit codes as the transcript, and file with `--result`.
