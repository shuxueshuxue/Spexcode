---
scenarios:
  - name: a-revision-is-classified-by-what-it-actually-changed
    description: >
      Drive the real `spex spec report` CLI over a scratch Git repo carrying four revisions, one per
      classification the report must tell apart: an ack stamp (`spex spec ack` commits `--allow-empty
      --only`, so the revision changes no file at all), a code-only change under `packages/` that touches
      no spec.md, a governance edit that moves a `code:` claim and adds a `related:` row, and an append to
      an `evals.ndjson`. Read the CLI's actual stdout for each; never reason from the source.
    expected: >
      The ack stamp and the evals.ndjson append each emit `ack/eval only, no body change (empty=true)`,
      suppressed to the single line `no body change` when `--always` is absent. The `packages/` code change
      is NEVER called ack/eval — it names the file with its numstat and resolves its governing node. The
      governance edit is named on the status line as `+code:` / `-code:` / `+related:` rows carrying the real
      paths, and those rows do NOT also appear among the `body:` lines, where they would read as edited
      prose. Two runs of the same revision are byte-identical.
    tags: [cli]
---

# measuring change-report

YATU: run the shipped `spex spec report` bin exactly as a sender would, against a repo whose history was
built to contain each case, and read the real stdout. A classification bug is invisible to reasoning about
the predicate — `ack` matched `packages` as a substring for as long as nobody ran the command on a
`packages/`-only commit — so the measurement builds the revision and reads what the CLI actually prints.
Zero loss = every revision described as the thing it is; loss = any revision whose report contradicts its
own diff, in either direction.
