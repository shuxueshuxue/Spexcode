---
concern: spex CLI truncates piped stdout over 64KB — process.exit before drain
by: c3f86a1a-5fb5-437c-95a8-5ef7d5d761e6
status: landed
created: 2026-07-02T17:58:58.757Z
---

Reproduced 2026-07-02: `spex issues --all --json | anything` dies mid-JSON at exactly 65536 bytes (one pipe buffer), while `> file` redirect yields the full valid 110KB. Cause: cli.ts's `process.exit(await runX(...))` pattern exits before the piped stdout drains — Node truncates pending pipe writes on exit. Every large-output verb is affected (issues --json, board, review --json...); it just got easier to hit now that forge replies[] fatten the issues JSON. Fix shape: flush-then-exit (e.g. `process.stdout.write('', () => process.exit(code))`) or process.exitCode where nothing holds the loop open. Found while measuring the forge-replies unification; out of that node's scope so recorded here.
