---
scenarios:
  - name: setup-topic-teaches-host-dashboard
    description: >
      Run the real CLI verb `spex guide` and read its stdout. The installed-user workflow must explain
      the host-level multi-project architecture and keep source-contributor hot-reload commands separate.
    expected: >
      Output teaches one `spex serve` per project, registration in the current user's host registry, and
      one `spex dashboard` that discovers already-running and later-started backends. It names `/projects`
      as the global switcher/management surface and `/p/:id/` as each project dashboard's scope, identifies
      `npm run api` / `npm run web` as contributor commands, and does not teach `spex serve ui`,
      `--api-port`, or per-project UI/API port pairing.
    tags: cli
    code: spec-cli/src/guide.ts
  - name: config-topic-prints-settings-manual
    description: >
      Run the real CLI verb `spex guide settings` and read its stdout. It must print the runtime-settings
      manual for .spec/spexcode.json / .spec/spexcode.local.json — the Config fields plus the crucial committed-vs-
      host-local file distinction, with the clean-init launcher commands and a concrete host-local profile
      example. The unknown-topic fallback has its own scenario below and is not probed here.
    expected: >
      Output names BOTH files by role (.spec/spexcode.json = committed/portable, .spec/spexcode.local.json =
      gitignored/host-specific), documents the launcher schema
      (launchers: { <name>: { harness, cmd } } and defaultLauncher), and shows the working split — the
      portable defaultLauncher name in the committed file, the host absolute `cmd` in the local file.
      It names `claude`, `codex`, `opencode`, and `pi` as the plain clean-init commands and says automatic-
      permission variants (`--dangerously-skip-permissions`, `--yolo`, `--auto`) require an explicit launcher.
      Field coverage spans layout, dashboard, sessions, serve, issues, deterministic lint policy, and
      doctor health budgets. The layout section says `mainBranch` is stamped once at adoption and remains
      stable across later checkouts. Active altitude and breadth thresholds appear only under `doctor.altitude`
      and `doctor.breadth`, not under `lint`; the retired `lint.maxChildren` spelling appears only in a
      migration note naming its doctor replacement.
      The sessions section explains maxActive's default and that it counts compute slots, not total
      sessions.
    tags: cli
    code: spec-cli/src/guide.ts
  - name: unknown-topic-names-every-registered-topic
    description: >
      Run `spex guide <unknown>` and read the loud failure, then count the topics the CLI actually serves by
      driving each one — `spex guide <topic>` for every key in guide.ts's TOPICS registry — and compare the
      two sets. The denominator is the registry (the surface that does NOT print the message); the numerator
      is the list the error message prints. Both must be reported as `N of N`.
    expected: >
      Exit is non-zero and stdout carries no page. The printed `Topics:` list equals the registry's key set —
      `N of N` with N counted off the registry, not off the message — and every listed topic really serves a
      page (each `spex guide <topic>` exits 0 with its own header). The reading names N. A reading whose two
      sides come from the same source does not count: the message's own list can never disagree with itself,
      so a reading that counts the printed names and then checks the printed names asserts nothing.
    tags: cli
    code: spec-cli/src/guide.ts
  - name: eval-topic-keeps-step-names-label-only
    description: >
      Run `spex guide eval` and read the printed --timeline section. The manual must be prescriptive
      about step-name semantics, not just the JSON shape: a step is a short human label for its moment,
      and run metadata must not be smuggled into it.
    expected: >
      The timeline passage states that a step name is a SHORT human label and never a metadata channel,
      and names the canonical homes for what emitters are tempted to smuggle — the run's identity in the
      scenario's `test:` field, the verdict on the reading, the extent on the evidence itself — with the
      `runner start: <file> :: <case title>` shape called out as the anti-pattern.
    tags: cli
    code: spec-cli/src/guide.ts
---
Measured by YATU: run the actual `spex guide` verb and read its printed output, never by reasoning about
guide.ts. The guide is a reference surface, so the product surface a user touches IS the printed manual —
the measurement drives the real CLI and inspects real stdout.
