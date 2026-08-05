---
scenarios:
  - name: valued-session-new-flags-stay-out-of-positionals
    description: >
      Through the real `spex session new` CLI, pass a nonexistent `--prompt-file` with a spaced `--name`, then
      repeat it with `--base`. Both forms must reach the prompt-file refusal before any backend contact. With a
      nonempty prompt file and an isolated empty `SPEXCODE_HOME` (no recorded backend), pass a commit-ish that
      cannot resolve as `--base` and inspect the CLI's local creation result.
    expected: >
      The `--name` and `--base` values are never reclassified as an inline prompt: each nonexistent file exits 2
      naming that file, not the either/or prompt error, and creates no session. The supplied invalid base reaches
      its own HTTP 400 target-resolution refusal before any session artifact is created. The value-flag guard fails
      when any allowed `flag(name)` input lacks the positional scanner's one value declaration.
    tags: [cli]
    code: spec-cli/src/cli.ts
    related: spec-cli/src/session-create-cli.test.ts
  - name: session-send-flags-cannot-become-the-message
    description: >
      Drive the real `spex session send` CLI against a recording HTTP backend twice, once as
      `session send <SEL> "<msg>" --api <url>` and once as `session send <SEL> --api <url> "<msg>"`,
      then inspect the POST bodies rather than trusting the CLI receipt. Send the single-token option-shaped
      message `--force` once through the documented `--` delimiter and once without it. Also invoke send with no
      message, an extra message, an unknown flag, duplicate `--api`/`--port`/`--keys`, and missing values while
      the backend records every request. Finally send the recognized option names `--api`, `--port`, and
      `--insecure` as payloads after `--`, while a real routing flag before the delimiter points at the recorder.
    expected: >
      Both valid orders exit zero, print `sent`, and POST the exact caller-authored message rather than a routing
      flag; `--` delivers the exact option-shaped message, while omitting the delimiter fails loud. Missing/extra
      message, unknown flag, duplicate valued flag, and missing value all exit 2 before selector resolution or
      dispatch, print no false `sent`, and make zero backend requests. Raw keys retain their exact one-value face.
      Every recognized option-shaped payload reaches the POST byte-exactly and is ignored by all downstream
      routing/auth readers; the delimiter cannot be locally correct in the parser but reinterpreted later.
    tags: [cli, backend-api]
    code: [spec-cli/src/cli.ts, spec-cli/src/session-send-cli.test.ts]
  - name: help-journey
    description: >
      Walk the three help layers as a fresh agent would, through the real CLI: (1) `spex help` — the
      map must open with the noun-first grammar, list the six noun drawers and the project verbs, and
      state the shared conventions (SEL · `.` · --json · --api routing · mentions) once; (2)
      `spex help session` plus `spex session send --help`, `spex session wait --help`, and
      `spex session new --help` — the first is the complete drawer while each noun-verb probe is only
      that verb's exact usage, projected from the shared drawer definition. The exact entries preserve
      their caveats (watch never exits; wait is edge-triggered; send --keys is last-resort/unstable) and
      shared safety notes (SEL grammar on selector verbs; project-bound warning on writes), plus the
      map/guide footer; (3)
      `spex guide eval` — the skill page must footer back to the help layers. Also probe the
      dead-ends: `spex nosuch`, `spex help nosuch`, `spex guide nosuch`, bare `spex internal`, and an
      unknown drawer verb (`spex spec nosuch`) must each fail loud AND name the layer to return to;
      `spex session new --help` must print help without creating a session.
    expected: >
      Every probe answers with the right layer and a pointer onward — no output that strands the
      reader, no repeated full session drawer from a noun-verb probe, no side effect from a --help probe,
      and no machine-plumbing verb (internal trunk / check-staged / session-state / nudge / codex-launch)
      on the `spex help` map.
    tags: [cli]
    code: [spec-cli/src/help.ts, spec-cli/src/cli.ts]
    related: [spec-cli/src/guide.ts]
  - name: plumbing-not-top-level
    description: >
      The machine tokens must be gone from the porcelain top level: `spex trunk`, `spex
      codex-launch`, `spex codex-turn`, `spex propose` each exit non-zero as unknown commands, while
      `spex internal trunk` prints the resolved trunk branch, `spex internal commit-gate` runs the
      deterministic commit check, and `spex internal spec-governors <path>` prints one stable
      `id<TAB>spec-path` row per real `code:` owner (empty for an ungoverned/related-only path). The
      `spec-governors` token must be absent from `spex help` and unknown at the porcelain top level.
      The pre-commit template resolves the trunk through
      `spex_cli internal trunk` (with its pure-git fallback intact for stale hooks) and shims lint
      through `spex_cli spec lint` + `spex_cli internal check-staged`.
    expected: >
      Old top-level tokens are unknown (exit 2, pointing at `spex help`); `spex internal trunk`
      prints the trunk; `internal spec-governors` returns only real governors without widening the
      public vocabulary; the installed hooks call only new spellings.
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
      `blob …`, `issues …`, `forge …`, `resolve`/`retract`,
      `session rawkey`, `session state`, `doctor contract`. (`dashboard` left this list when the name
      was reclaimed as a live project verb — the host gateway, [[host-gateway]]; probe that it RUNS
      a gateway now, e.g. `spex dashboard --help` prints usage, not a signpost.) The `yatsu` tombstone was retired EARLY
      by human ruling (ahead of its 0.4.0 schedule): `yatsu …` now exits 2 as a plain unknown
      command pointing at `spex help` — no replacement line. A signposted verb must produce no side
      effect (e.g. `spex board` writes no JSON to stdout).
    expected: >
      Bare nouns = drawer help (exit 0); new spellings behave; removed spellings exit 2 with a
      one-line signpost naming the new spelling and never execute the old verb; `yatsu` (tombstone
      retired early) exits 2 as a plain unknown command with the `spex help` pointer.
    tags: [cli]
    code: [spec-cli/src/cli.ts, spec-cli/src/help.ts]
  - name: owner-report-consults-both-tracking-axes
    description: >
      Ask the real CLI for `spec owner` on EVERY related-only file in the repository — each path some node
      references but no node code:-claims — and classify which tracking sentence each answer used. Build both
      the population and the per-file expectation from an independent parse of the .spec registry, not from
      the CLI's own output, so the two sides can disagree; then check the named scenarios against that parse
      by count and by identity on the most-anchored file. Also confirm the --actionable hook path is
      unchanged for a related-only file.
    expected: >
      Every file the registry says has at least one scenario code: anchor gets the eval-axis report, and
      every file it says has none keeps the older sentence — both counts complete, with zero disagreements
      across the whole population. The anchored report names the anchoring scenarios by node and scenario
      name and says the drift is tracked on the eval axis only while no spec body states what the file should
      do; it never says nothing tracks its drift, because that sentence is a verdict about both axes and the
      spec axis is empty here precisely when the eval axis is not. The named set equals the registry's code:
      anchors for that path exactly — same count, same identities — which is what makes the reading
      cross-source rather than a message quoting itself. The unanchored side is measured over its whole
      population rather than one sampled file, because that side is the MAJORITY here and a criterion that
      probes one of it goes green through a regression in the rest: the negative branch must stay reachable
      for all of them, so the fix cannot trade a false universal for an unconditional claim. --actionable
      still exits 0 silently for a related-only file either way, since a soft edge is not worth interrupting
      an edit for.
    tags: [cli]
    code: [spec-cli/src/cli.ts]
    related: [spec-eval/src/scenarios.ts, spec-cli/src/specs.ts]
---

Measure through the real CLI binary (`node spec-cli/bin/spex.mjs …`), never by reading help.ts: run
each probe, capture stdout/stderr + exit codes as the transcript, and file with `--result`.

Spelling that path out matters asymmetrically, and the asymmetry runs opposite to where attention goes. In a
worktree the bare word `spex` resolves to a globally installed copy of some other version, so a probe that
reaches for it measures a different program than the tree under test. On the PASS side that mistake is
self-announcing: the other program cannot produce the behaviour being claimed, so the reading fails rather
than lies. On the FAIL side it is invisible — an older install and a not-yet-fixed tree emit byte-identical
output — so the `--fail` half of a pair is precisely the one that can be measured with the wrong instrument
and still look right. The invocation is therefore worth recording beside the fail reading, where nothing else
would catch it, rather than beside the pass reading, where the measurement catches it for free. The same
hazard reaches review: a reviewer standing in the worktree types the bare word, sees the old sentence, and
concludes the fix is absent.
