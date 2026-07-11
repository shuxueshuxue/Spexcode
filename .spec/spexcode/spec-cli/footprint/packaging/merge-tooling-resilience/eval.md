---
scenarios:
  - name: midmerge-graceful-error
    description: >
      In a scratch clone of this repo, create a GENUINE merge conflict in spec-cli/src/cli.ts (two branches
      editing the same line, then `git merge` — the working tree holds real conflict markers and
      .git/MERGE_HEAD exists, exactly the state a dispatched merge-resolution leaves main in). Run the
      launcher from that clone: `node spec-cli/bin/spex.mjs internal trunk`.
    expected: >
      A single clean stderr message — "spex: paused mid-merge — unresolved conflict markers in the source
      spex runs", naming the conflicted file(s) and telling the caller to resolve the merge and retry — and
      exit code 75 (EX_TEMPFAIL). No esbuild TransformError, no raw stacktrace.
    tags: [cli]
    code: spec-cli/bin/spex.mjs
---

Measured YATU through the real launcher binary against a real git merge-conflict state, never by unit-testing
the scan function: clone the repo somewhere scratch, manufacture the conflict with git itself, invoke
`spec-cli/bin/spex.mjs` as a manager or hook would, and read stderr + exit code (`--result` transcript).
