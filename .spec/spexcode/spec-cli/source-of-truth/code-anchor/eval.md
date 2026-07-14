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
  - name: multi-selector-dedupe
    tags: [cli]
    description: >
      Fixture node pins several same-file selectors (src/calc.ts#applyRate + #helper — and a variant
      with 4+ selectors, since no selector-count cap exists); one post-version commit changes lines
      inside BOTH units. Run `spex spec lint`.
    expected: >
      Exactly ONE `anchor-drift` error for the entry (never one per selector — the commit counts once),
      naming both hit selectors (#applyRate, #helper); exit 1. The 4-selector variant lints clean with
      no integrity/one-govern error, and a hit on the 4th unit blocks.
  - name: structural-defects-error
    tags: [cli]
    description: >
      Three malformed fixtures: (a) the same selector listed twice; (b) one base path listed both bare
      and with a selector in one relation; (c) selectors on two DIFFERENT files in code:. Run
      `spex spec lint` on each.
    expected: >
      (a) and (b) are `integrity` errors naming the duplicate / the bare-scoped mix; (c) stays the
      ordinary `one-govern` error (one-govern counts distinct base paths). Exit 1 in all three.
  - name: scoped-miss-setting
    tags: [cli]
    description: >
      Anchored fixture where the post-version commit touches only a NON-pinned unit (a miss). Run
      `spex spec lint` with no setting, then with `lint.scopedCodeMiss: "ignore"` in spexcode.json,
      then touch the pinned unit under "ignore".
    expected: >
      Default: the ordinary advisory `drift` warn appears, no anchor-drift, exit 0. With "ignore": that
      one advisory disappears (exit 0, nothing else changes — bare nodes keep their drift warn). A HIT
      under "ignore" still raises the anchor-drift error, exit 1 — the knob never touches the block.
  - name: related-selector-hit-miss
    tags: [cli]
    description: >
      A node lists related: src/calc.ts#applyRate. One commit moves only another unit (miss), a later
      one moves applyRate (hit). Run `spex spec lint` after each.
    expected: >
      Miss: NO related-drift line for the scoped row — silent. Hit: a soft `related-drift` warn naming
      the selector and the node; exit stays 0 both times (related never blocks, needs no ack, feeds no
      eval freshness).
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
