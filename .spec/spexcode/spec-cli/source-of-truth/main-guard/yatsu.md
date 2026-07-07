---
scenarios:
  - name: ack-on-merge-commit
    description: >
      In a scratch clone with the hooks installed, create real drift (commit a change to a governed
      file on a node branch without touching its spec), merge it --no-ff into the trunk, then run
      `spex ack <node> --reason "…"` while HEAD is that merge commit — no SPEXCODE_ALLOW_MAIN, no
      SPEXCODE_SKIP_LINT. Then run `spex lint` and check the node's drift.
    expected: >
      The ack succeeds: main-guard passes the stamp (its tree equals HEAD's tree, so nothing can be
      smuggled), a commit carrying the `Spec-OK: <node>` trailer lands on the trunk above the merge,
      and `spex lint` no longer reports the acknowledged drift. A commit on the trunk that DOES
      change the tree is still blocked.
    tags: [cli]
    code: [spec-cli/templates/hooks/pre-commit]
    related: [spec-cli/src/cli.ts, spec-cli/src/git.ts]
---

Measured YATU through the real surfaces: the installed pre-commit hook (a real `git commit`, not a
bash re-derivation of the guard) and the real `spex ack` / `spex lint` CLI, in a throwaway clone so
the dogfood trunk is never touched. Evidence is the CLI transcript (`--result`).
