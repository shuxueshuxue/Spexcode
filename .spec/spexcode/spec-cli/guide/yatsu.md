---
scenarios:
  - name: config-topic-prints-settings-manual
    description: >
      Run the real CLI verb `spex guide config` and read its stdout. It must print the runtime-settings
      manual for spexcode.json / spexcode.local.json — the Config fields plus the crucial committed-vs-
      host-local file distinction, with a concrete launcher-profile example. Also probe an unknown topic
      (`spex guide bogus`) to confirm the fallback still names the real topics.
    expected: >
      Output names BOTH files by role (spexcode.json = committed/portable, spexcode.local.json =
      gitignored/host-specific), documents the launcher schema
      (launchers: { <name>: { harness, cmd } } and defaultLauncher), and shows the working split — the
      portable defaultLauncher name in the committed file, the host absolute `cmd` in the local file.
      Field coverage spans layout, dashboard, sessions, serve, proposals, and lint budgets. The unknown
      topic fails loud, listing `Topics: spec, yatsu, config`.
    tags: cli
    code: spec-cli/src/guide.ts
---
Measured by YATU: run the actual `spex guide` verb and read its printed output, never by reasoning about
guide.ts. The guide is a reference surface, so the product surface a user touches IS the printed manual —
the measurement drives the real CLI and inspects real stdout.
