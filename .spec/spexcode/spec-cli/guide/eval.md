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
      manual for spexcode.json / spexcode.local.json — the Config fields plus the crucial committed-vs-
      host-local file distinction, with a concrete launcher-profile example. Also probe an unknown topic
      (`spex guide bogus`) to confirm the fallback still names the real topics.
    expected: >
      Output names BOTH files by role (spexcode.json = committed/portable, spexcode.local.json =
      gitignored/host-specific), documents the launcher schema
      (launchers: { <name>: { harness, cmd } } and defaultLauncher), and shows the working split — the
      portable defaultLauncher name in the committed file, the host absolute `cmd` in the local file.
      Field coverage spans layout, dashboard, sessions, serve, issues, and lint budgets. The sessions
      section explains maxActive's default and that it counts compute slots, not total sessions. The
      unknown topic fails loud, listing `Topics: spec, eval, settings, footprint`.
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
