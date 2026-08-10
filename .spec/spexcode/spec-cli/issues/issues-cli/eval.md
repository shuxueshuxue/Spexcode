---
scenarios:
  - name: issue-drawer-parse-render-and-exit
    tags: [cli]
    code:
      - spec-cli/src/issues-cli.ts#runIssues
      - spec-cli/src/issues-cli.ts#runIssueWrite
    description: >-
      In a disposable adopted Git repository with SPEXCODE_ISSUES_DIR pointed at a disposable directory,
      exercise the real `spex issue` CLI. Open a local issue with an interleaved `--node` value and a body
      read from stdin, capture the id it prints, then read that id with `show --json` and the linked node
      through human-readable `ls --node`. Also invoke `issue show` without an id and the retired `issue on`
      spelling, recording stdout, stderr, and each shell exit status.
    expected: >-
      `open` exits 0, preserves the positional concern despite its interleaved value flags, prints the minted
      local id and linked node, and points the user to `spex issue ls`. `show --json` exits 0 with that id,
      concern, stdin body, `store: local`, and linked node; `ls --node` exits 0 and renders the same open
      thread for a human. Missing `show` id and retired `on` both exit 2 with their actionable usage/signpost
      text, never a raw stack or a successful no-op.
---

# issues-cli — measurement method

Measure through the installed `spex issue` command against a disposable adopted repository and disposable
issue store. Capture the command transcript and shell statuses; do not substitute direct imports of the
issue or store modules for the terminal surface.
