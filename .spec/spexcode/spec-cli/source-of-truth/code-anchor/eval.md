---
scenarios:
  - name: anchor-hit-blocks
    tags: [cli]
    description: >
      In a fixture repo, a node's code: entry anchors src/calc.ts#applyRate; after the spec's version
      commit, one commit changes lines INSIDE applyRate. Run `spex spec lint` in that repo.
    expected: >
      An `anchor-drift` ERROR names the anchor, the spec version, and the offending commit sha(s);
      exit code is 1 (the pre-commit shim blocks). A subsequent `spex spec ack <node> --reason "…"`
      quiets it (the reason lands in the ack commit's message body) and lint returns to 0 errors.
  - name: outside-change-warns
    tags: [cli]
    description: >
      Same fixture shape, but the post-version commit changes only a NON-anchored unit (helper) in the
      governed file. Run `spex spec lint`.
    expected: >
      Only the advisory `drift` WARN appears (file ahead of spec); NO anchor-drift error; exit code 0 —
      an anchored node still never blocks on changes outside its anchored unit.
  - name: dead-anchor-errors
    tags: [cli]
    description: >
      Same fixture; a commit renames applyRate so the anchor no longer resolves on the current tree.
      Run `spex spec lint`.
    expected: >
      An `integrity` ERROR reading "dead anchor" says the unit was deleted or renamed and tells the
      author to update the spec's code: entry; exit 1. (An ambiguous anchor — two same-named units —
      errors the same way, worded "ambiguous anchor".)
  - name: no-typescript-errors
    tags: [cli]
    description: >
      Same fixture with an anchored .ts entry, but the host repo has NO resolvable typescript
      (nothing on the node_modules walk-up). Run `spex spec lint`.
    expected: >
      An `integrity` ERROR states the ts-ast extractor cannot run and spells the repair — run
      'npm i -D typescript' or remove the #anchor; exit 1. No silent pass and no regex downgrade:
      the JS family's designated extractor is ts-ast only.
---
# code-anchor — measurement

Measured YATU through the real CLI: build a throwaway git repo (seed commit = spec v1 + governed
source; follow-up commits shape each scenario), run `spex spec lint` in it, and read the real stderr
transcript + exit code. Historical blobs that fail to parse must surface as conservative hits with an
explicit note, never a silent skip.
