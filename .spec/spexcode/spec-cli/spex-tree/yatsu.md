---
scenarios:
  - name: tree-render
    description: >
      Through the real CLI (`tsx spec-cli/src/cli.ts tree …`), read the graph the way a pure-CLI
      user would: (1) bare `spex tree` piped — the full forest, one node per line with id, a
      bracketed status word, and drift/stale/issues badges where the board carries them, NO ANSI
      codes (not a tty); (2) `spex tree` on a tty — the same lines now status-coloured, and with
      NO_COLOR=1 the colour drops again; (3) `spex tree --node <id> --depth 1` — just that subtree,
      pruned children counted, never silently dropped; (4) `spex tree --node <bogus>` — exit 2 with
      a message naming the recovery; (5) `spex tree --node <id> --json` — nested objects with badge
      counts precomputed.
    expected: >
      Every probe renders the same board the dashboard shows — statuses and badge counts match
      `spex board`'s JSON — with colour present exactly when stdout is a tty and NO_COLOR unset,
      the status word always printed, prunes counted, and the unknown id failing loud (exit 2).
    tags: [cli]
---

Measure through the real CLI binary, never by reading tree.ts: run each probe, capture
stdout/stderr + exit codes (pipe through `cat -v` for the tty/colour probes so the presence or
absence of `\x1b[` codes is in the transcript), and file with `--result`.
