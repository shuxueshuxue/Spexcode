---
scenarios:
  - name: links-report-pair
    tags: [cli]
    code: spec-forge/src/cli.ts
    related: [spec-forge/src/links.ts, spec-forge/src/needs-eval.ts]
    description: >-
      In the live repo (real `gh`, real open issues/PRs), run the read pair through the real CLI:
      `spex issue links`, `spex issue links --json`, `spex issue links --pending`, `spex issue links
      --pending --json`, and each narrowed with `--node <a-linked-id>` and with a node that links nothing.
    expected: >-
      Both reports read alike: a header line reporting the link counts AND how many issues/PRs were scanned
      (an empty result stays legible — nothing linked vs nothing to scan), then `node → linked work` lines
      (`--pending` prints `node → evaluation owed` instead). `--node` narrows to that one node; a node with
      no links yields the header with an empty body, never an error. `--json` emits the raw resolved
      structure (`--pending --json` = the NodeEvalPending[] shape). Reading is live through the driver and
      read-only — no store file, no node status changes.
---

# measuring forge-cli

YATU on the real product surface: the actual `spex issue links [--pending]` verbs against the live
repo's forge (`gh` auth, real open issues/PRs) — never the standalone proof script or the resolver in
isolation. The transcript of both reports (text + `--json`) is the reading; the loss is any way the CLI
exposure diverges from [[links]]/[[needs-eval]]'s resolution or goes silent where the header should make
emptiness legible.
