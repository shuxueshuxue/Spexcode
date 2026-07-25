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
      Same fixture with an anchored .ts entry, but the governed host repo does not provide a usable
      typescript. Run the production-installed `spex spec lint`.
    expected: >
      Lint completes without throwing and emits an explicit extractor-unavailable `integrity` ERROR
      naming the ts-ast repair — install typescript in the host repo or remove the #anchor; exit 1.
      JS-family anchors are reported unverified and skipped (the error is not an anchor pass); there is
      no regex downgrade, and the remaining lint rules still run.
  - name: python-qualified-anchors
    tags: [cli]
    test:
      path: spec-cli/src/lint-scoped.test.ts
      name: Python LangSpec resolves module/async/method/nested names and their drift through the real CLI
    description: >
      In a fixture repo, pin a Python module function, async function, class method, nested function,
      and nested-class method in one code: entry. Run `spex spec lint`, then change each unit (including
      only the async function's decorator) in one commit and lint again.
    expected: >
      The initial lint exits 0 with every selector resolved. After the commit, exactly one
      `anchor-drift` ERROR names all five selectors, preserving same-file OR/dedupe semantics and
      treating attached decorators as part of the declaration range.
  - name: python-dead-ambiguous
    tags: [cli]
    test:
      path: spec-cli/src/lint-scoped.test.ts
      name: Python dead and duplicate qualified symbols keep the generic loud integrity verdicts
    description: >
      In a Python fixture, anchor a missing qualified method and a method declared twice under the same
      class. Run `spex spec lint` through the real CLI.
    expected: >
      Lint exits 1 with a `dead anchor` integrity error for the missing qualified name and an
      `ambiguous anchor` integrity error reporting both duplicate qualified declarations.
  - name: historical-memo-key
    tags: [cli]
    test:
      path: spec-cli/src/anchors.test.ts
      name: historical unit memo keys filename semantics when same bytes share one blob
    description: >
      In a fixture repository, two anchored files with identical bytes and blob ids use `.ts` and `.tsx`
      script kinds. Run historical anchor queries in both orders and repeat both queries in the same process.
    expected: >
      The `.tsx` historical parse remains conservative-unparseable and the `.ts` parse remains valid in
      either order and on repeat; normalized results do not depend on directory or query order. A key must
      cover the complete extractor input, not only the Git blob oid and extractor label.
  - name: candidate-tip-gate
    tags: [cli]
    description: >
      In a real temporary Git repository with an anchored node, exercise the installed local gate through
      ordinary commit, merge, squash, commit --only with conflicting unstaged worktree content, cherry-pick,
      rebase, --no-verify, and a clone with no hooks. First try an anchored implementation-only commit with
      no declaration; then try the same candidate with either the node's spec.md changed in that commit or
      a `Spec-OK: <node>` trailer.
    expected: >
      On paths where Git invokes the installed gate (ordinary commit, merge, squash, and a conflict's manual
      commit), each new commit is judged against its own final tree, message, parents, and ancestry before
      its ref advances. The undeclared anchor hit is rejected and leaves the original branch ref in place;
      changing code and spec together passes because the candidate spec version closes the window; an
      in-commit Spec-OK trailer also passes without pardoning older debt. A --only verdict sees only paths
      actually present in that candidate; conflicting unstaged worktree content cannot affect it. On paths
      that do not invoke the gate (cherry-pick, rebase, --no-verify, and a clone without hooks), local
      coverage remains equal to today's rather than promising an impossible immediate rejection; once such
      a commit lands, the ordinary HEAD predicate used by CI still reports its unanswered drift.
      A combined merge hunk containing both a side-inherited anchored line (`+ `) and an adjacent
      merge-authored ungoverned line (`++`) does not charge the inherited line or reject the merge; combined
      ownership is decided per result line, never by widening one owned line to its enclosing hunk. Its
      mirror, with `++` on the anchored line and the inherited line ungoverned, is rejected and names that
      selector.
      Likewise, a `spec.md` whose merge result only combines different parent-authored lines has no
      all-parent line and does not become a merge version; it cannot wash out an anchored line genuinely
      authored by that same merge.
      Candidate lint additionally rejects deleting a governor while its former governed subject survives
      without a new `code:` owner; deleting that implementation or transferring it in the same candidate
      passes. This transition-only integrity check is not claimed to be a HEAD-reconstructible anchor rule.
---
# code-anchor — measurement

Measured YATU through the real CLI: build a throwaway git repo (seed commit = spec v1 + governed
source; follow-up commits shape each scenario), run `spex spec lint` in it, and read the real stderr
transcript + exit code. Historical blobs that fail to parse must surface as conservative hits with an
explicit note, never a silent skip.
