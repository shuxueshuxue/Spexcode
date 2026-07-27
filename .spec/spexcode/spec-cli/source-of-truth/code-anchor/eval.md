---
scenarios:
  - name: fold-project-boundary
    tags: [cli]
    code: [spec-cli/src/git.ts#canonicalPathProjector]
    test:
      path: scripts/anchor-drift-fold-proof.mjs
      name: fold/project lower bound and pinned-history equivalence proof
    description: >
      On the pinned 4,266-commit / 217-node reference clone, fold the contract-defined spec-version
      events into maximal reachability antichains, project them through the product's rename identity,
      and independently filter retained anchor hits under walk-newest, any-frontier and all-frontier
      rules. Then run the pinned baseline and candidate CLIs in separate clean checkouts/processes/homes at
      the 14 fixed tips, capturing both stdout and stderr on every exit status; compare the candidate's
      incremental result with its eager fetch-layer result separately.
    expected: >
      The walk-newest version base equals the product-selected base for all 217 current nodes, and the exact
      walk-newest drift/related-drift triples equal the corrected 14-point oracle at every point. The
      minimal parallel-version DAG has clear parent verdicts but revives the losing branch's hit after the
      merge, proving that (v, D) cannot be joined after forgetting cleared hits. Hit identities derived from
      the complete drift event index grow with events (249 / 550 / 840 at depths 1,002 / 2,497 / 4,200; 841
      at the tip). The proof rejects both known lossy proxies: path-limited history simplifies away eight
      events, while reading historical blobs/ranges through the current name misses 86 pre-rename hits plus
      one same-path deletion. It also rejects a result-only rename query that invents three full-addition
      hits absent from the real two-image patches. Rename projection stays empirically short (maximum 4, mean 1.51) without
      being asymptotically O(1). Before the 14-point comparison, a 13-anchor positive fixture blocks in both
      immutable CLI implementations; deleting one actual normalized anchor row produces exactly that one
      missing key. Per-rule coverage is printed for every historical point, and zero anchor rows there is
      reported as zero coverage rather than described as an anchor test.
  - name: anchor-hit-blocks
    tags: [cli]
    code: [spec-cli/src/git.ts#canonicalPathProjector, spec-cli/src/anchors.ts#anchorHitCommits]
    description: >
      In disposable fixture repos, a node's code: entry anchors applyRate. Exercise a direct edit, an edit
      under the file's historical name followed by a rename, a delete followed by a self-acked restore, and
      a merge-authored deletion whose two parents call the file by different names. Finally, let a merge
      author only old.py->new.py after a side-branch hit, including a repeated-result (`RR`) merge rename;
      and let incomparable hit/rename branches merge with
      both old.py and new.py surviving. Run `spex spec lint` after each shape.
    expected: >
      Each `anchor-drift` ERROR names the anchor, the spec version, and only the offending edit/deletion sha;
      rename projection, a later self-ack, and combined parent paths never erase that historical hit.
      The rename-only merge transports identity but is not itself charged as a hit. Exit code is 1 (the
      pre-commit shim blocks). A subsequent `spex spec ack <node> --reason "…"`
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
      name: historical extractor memo stays stable across order and same-process repetition
    description: >
      In a fixture repository, two anchored files with identical bytes and blob ids use `.ts` and `.tsx`
      script kinds. Run historical anchor queries in both orders and repeat both queries in the same process.
    expected: >
      The `.tsx` historical parse remains conservative-unparseable and the `.ts` parse remains valid in
      either order and on repeat; normalized results do not depend on directory or query order. A key must
      cover the complete extractor input, not only the Git blob oid and extractor label.
  - name: event-ledger-test-unicode-worktree
    tags: [backend-api]
    test:
      path: spec-cli/src/git.test.ts
      name: concurrent different-tip builders share an atomic ledger and recover on reopen
    code: spec-cli/src/git.test.ts
    description: >
      Check out the same committed tree into one ASCII path and one path containing non-ASCII characters,
      with local dependencies present in both. In each worktree run only the real concurrent different-tip
      event-ledger test, which starts child TypeScript processes importing the candidate git.ts.
    expected: >
      Both paths pass the same test. The child import resolves the exact candidate file in the worktree;
      a file URL's percent escapes are decoded once at the URL-to-path boundary and never passed back as a
      literal filesystem path or encoded a second time.
  - name: event-ledger-content-integrity
    tags: [backend-api]
    code: spec-cli/src/git.ts
    description: >
      In a temporary hand-built Git repository, seed the persistent history event ledger, corrupt one byte in
      a numstat row while leaving its stream tip marker and the remaining NDJSON parseable, then start a fresh
      product read and compare it with the uncached full-history implementation. Repeat on a governed-code row
      through the real `spex spec lint` CLI. Then inject a Git wrapper whose `rev-parse` succeeds but whose event
      `log` exits non-zero, and repeat in a SHA-256 repository whose commit ids are 64 hexadecimal characters.
      The measurement fixture is disposable evidence, not a permanent sample piled into the unit suite.
    expected: >
      The complete ledger fails its content-integrity check, is discarded, and is rebuilt from immutable Git
      objects. The cached and uncached version rows remain identical; a syntactically usable remainder is
      never accepted as a partial truth merely because its tip marker survived. A failed event scan throws and
      mints no marker; after real Git returns, the next read discovers the missed commit. SHA-1 and SHA-256 repos
      both retain their complete reachable commit set, with the object format participating in cache identity.
      Product lint retains the original drift finding after rebuilding instead of silently returning a cleaner
      verdict. A live lock owner cannot be displaced by age; after a proven-dead owner is reclaimed, concurrent
      writers retain the union of their successfully scanned events.
  - name: parallel-version-debt-reappears
    tags: [cli]
    test:
      path: spec-cli/src/git.test.ts
      name: parallel spec versions prove that reset drift debt is not a scalar merge fold
    description: >
      In a real Git DAG, branch A versions one spec, while branch B changes its governed file and then
      versions the same spec. Merge B into A without authoring an all-parent spec line, and make A's
      version the walk-newest of the two incomparable versions.
    expected: >
      Each parent is locally clean, but the merged tip selects A's version and reports B's earlier code
      commit as drift because it is not reachable from A. The merge itself is not a version. This proves
      that a parent state which reset B's debt at B's version cannot supply the exact merged judgment.
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
