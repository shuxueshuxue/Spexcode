---
scenarios:
  - name: scan-eval-clean-loop
    tags: [cli]
    description: >-
      Drive the whole loop through the real `spex eval` CLI on this node: file a reading with
      `spex eval add eval-core --pass`, confirm `spex eval lint` does not flag it, move a
      governed code file and commit, confirm `spex eval lint` now reports it stale on the code
      axis, then run `spex eval clean --all`.
    expected: >-
      A reading lands in evals.ndjson with no browser and no test run; lint is quiet while
      the reading is fresh and flags it stale only after the governed file moves; clean empties
      the cache while the records still resolve (their blobs render as the miss-original-file
      sentinel).
  - name: uncovered-fires-on-any-source
    tags: [cli]
    code: [spec-eval/src/cli.ts]
    description: >-
      Through the real `spex eval lint` in a scratch repo: create a node that governs a NON-frontend
      source file (a backend `.ts`, and — after setting `lint.sourceExtensions: ["rs"]` in spexcode.json
      — a Rust `.rs`) with NO eval.md; also a control node governing a `.jsx` file, and a node governing
      only a non-source file (a `.md` / a `.sh` hook). Run `spex eval lint` and read the `eval-coverage`
      lines and the summary count.
    expected: >-
      `eval-coverage` fires on ANY node governing a file whose extension is in the configured
      `sourceExtensions` (default ts/tsx/js/jsx) — the backend `.ts` node is flagged, not silently exempt,
      and the frontend control still flags. Configuring `sourceExtensions: ["rs"]` makes the `.rs` node
      flag while the `.ts` node stops. A node governing only a non-source file is never flagged. The
      finding says "governs source code" (not "frontend code"), so a non-web project's loss signal is no
      longer blind to its own sources.
  - name: schema-gate-rejects-malformed
    tags: [cli]
    description: >-
      Through the real `spex` surface, write a eval.md with a typo'd field key and a missing
      `expected` into a node dir, then (a) run `spex eval lint` and (b) stage it and run
      `spex internal check-staged`. File the transcript with
      `spex eval add eval-core --scenario schema-gate-rejects-malformed --result <txt> --pass`.
    expected: >-
      lint reports an `eval-schema` finding naming each violation (unknown key, missing required
      field) and counts it under "N malformed"; check-staged prints the same violations and exits
      non-zero (blocking the commit), while a well-formed staged eval.md exits zero.
  - name: sibling-edit-doesnt-stale
    tags: [cli]
    description: >-
      Through the real `spex eval lint`: take a node whose eval.md holds several scenarios with fresh
      readings, then land a change to ONE scenario's block, leaving every other scenario's block
      byte-identical — both the linear shape (commit the edit directly) AND the fleet-parallel shape
      (one branch edits scenario A and files A's reading, a SIBLING branch edits scenario B, the two
      merge). Re-run `spex eval lint` after each.
    expected: >-
      Only the scenario whose OWN semantic text (description + expected) moved is flagged `eval-drift`
      on the scenario axis; every sibling whose text is unchanged stays fresh — including across the
      merge: a reading filed on one branch is NOT re-staled by a sibling scenario's edit arriving from
      a parallel branch, so concurrent filing+merging converges to zero stale instead of each merge
      re-flagging the other branch's readings (issue #61's non-convergence).
  - name: dirty-governed-warns-at-filing
    tags: [cli]
    code: [spec-eval/src/cli.ts]
    description: >-
      Through the real `spex eval` CLI in a scratch repo: leave an UNCOMMITTED edit in a
      scenario's governed code file, run `spex eval add <node> --pass`, then commit that edit
      and re-run `spex eval lint`. Also file once following the honest measure→commit→file
      flow: measure on the working tree until green, commit that just-tested tree as-is, THEN
      file the reading against the clean HEAD.
    expected: >-
      add warns LOUD at filing time — a ⚠ line naming each governed file with uncommitted
      changes and saying the reading is MIS-ANCHORED from birth: codeSha can only name a
      commit, never a working tree, and HEAD does not contain the edits just measured, so the
      reading claims a pass for code that never ran — while still filing it (a warning, never
      a block; retract is the repair). A measure→commit→file reading prints no warning and
      stays fresh on the next lint; the later stale flag on a dirty-tree reading is freshness
      correctly exposing the mis-anchor, not an engine bug.
  - name: retract-undoes-a-botched-filing
    tags: [cli]
    description: >-
      Through the real `spex eval` CLI in a scratch repo: file a good reading, then a junk one (a
      simulated botched e2e/smoke run), confirm `ls` leads with the junk verdict, then run
      `spex eval retract <node> --scenario <s> --note <why>`. Re-run `ls` and `lint`; retract
      again until nothing is left, and check the loud error on one retract too many plus the
      unknown-flag rejection. Inspect the sidecar file itself.
    expected: >-
      retract appends a retraction event — no sidecar line is ever deleted or rewritten; the junk
      line stays in the file and `ls` renders the ⟲ retracted trace beside the readings. The
      effective scoreboard drops the retracted reading everywhere at once: the prior good reading
      is the latest again (lint quiet), and retracting every reading returns the scenario to
      eval-missing. A retract with no un-retracted reading left fails loud, as does an unknown
      flag.
  - name: metadata-sweep-doesnt-stale
    tags: [cli]
    code: [spec-eval/src/scenariofresh.ts]
    description: >-
      Through the real `spex eval lint` in a scratch repo: file a reading, then commit a
      TAGS-ONLY change to that scenario's block (add/reorder tags — the schema-clean sweep a
      real tree gets), leaving description and expected byte-identical; re-run lint. Then, as
      the control, commit an edit to the same scenario's `expected` and lint again.
    expected: >-
      The tags-only commit records NO scenario change — the reading stays fresh, lint stays
      quiet: routing metadata (tags, and the other non-semantic fields) is outside the
      scenario-freshness projection, so a metadata sweep can't spray false eval-drift across
      readings whose measurement contract (description + expected) never moved. The `expected`
      edit still flags eval-drift on the scenario axis — the semantic fields keep their teeth.
  - name: off-history-anchor-content-fallback
    tags: [cli]
    code: [spec-eval/src/freshness.ts]
    description: >-
      Through the real `spex eval lint` in a scratch repo: file a reading, commit the sidecar, then
      squash the history so the reading's codeSha is orphaned (off-history) while the governed code
      file and the scenario's eval.md block stay byte-identical; re-run lint. Then squash again WITH
      a real governed edit and lint. Finally expire the reflog and `git gc --prune=now` so the
      orphaned anchor commit object is truly gone, and lint once more.
    expected: >-
      An off-history codeSha alone is not stale: while the orphaned commit object still exists, lint
      falls back to comparing content — byte-identical governed files and an unchanged scenario block
      read fresh, so a fold/rebase/squash/cherry-pick that rewrites history without touching governed
      content raises no eval-drift. A genuine governed change still flags the moved axis. Only when
      the anchor commit object is truly gone does the conservative stale remain, reported as the
      anchor axis so it reads as "anchor lost", not "content changed".
  - name: leaf-collision-canonical-id
    tags: [cli]
    description: >-
      Through the real `spex eval` CLI in a scratch repo whose .spec tree holds THREE nodes sharing
      one leaf dir name (each with its own eval.md): run `spex eval ls`/`spex eval add` first
      with a node's canonical disambiguated id (the `_`-joined suffix the board/lint print, e.g.
      `a_web-remote-control`), then with the bare colliding leaf name.
    expected: >-
      The canonical disambiguated id — the id every other surface (board, lint, search) speaks —
      resolves to its node: ls renders that node's readings and add files against exactly it,
      never hasEvalFile:false. The bare leaf name, ambiguous across several measurable nodes, fails LOUD
      listing the candidate canonical ids — it never silently picks the first node in walk order.
      A non-colliding leaf keeps working bare, as the convenience it always was.
  - name: rename-chain-survives-archive-pathspec
    tags: [cli]
    code: [spec-eval/src/scenariofresh.ts, spec-eval/src/scenariofresh.test.ts]
    description: >-
      Regression for the yatsu.md→eval.md file rename: in a scratch repo, commit a scenario file under
      its ARCHIVED name yatsu.md, file a reading anchored there, then `git mv` it to eval.md (pure R100
      rename) and take further unrelated commits. Run the scenario-freshness engine (the real
      `spex eval lint` path / scenariofresh's index) against the renamed head path.
    expected: >-
      The per-scenario change-commit chain survives the rename: the whole-history walk's pathspec names
      BOTH '*eval.md' and the archived '*yatsu.md', so pre-rename commits still register, the pure-rename
      commit records no block change, and the pre-rename reading reads FRESH — never falsely staled by
      the migration. With a single live-name pathspec the chain truncates at the rename and the reading
      false-stales (the failure the regression test pins).
---
# eval.md — eval-core

This node's behaviour is measured through the `spex eval` CLI itself (YATU): the AGENT files a reading
with no browser and no executor, `lint` reflects freshness derived live from git, and `clean` prunes the
content-addressed cache. eval records the measurement and keeps score; it runs nothing.
