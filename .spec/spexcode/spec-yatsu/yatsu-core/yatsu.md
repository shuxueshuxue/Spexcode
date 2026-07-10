---
scenarios:
  - name: scan-eval-clean-loop
    tags: [cli]
    description: >-
      Drive the whole loop through the real `spex yatsu` CLI on this node: file a reading with
      `spex yatsu eval yatsu-core --pass`, confirm `spex yatsu scan` does not flag it, move a
      governed code file and commit, confirm `spex yatsu scan` now reports it stale on the code
      axis, then run `spex yatsu clean --all`.
    expected: >-
      A reading lands in yatsu.evals.ndjson with no browser and no test run; scan is quiet while
      the reading is fresh and flags it stale only after the governed file moves; clean empties
      the cache while the records still resolve (their blobs render as the miss-original-file
      sentinel).
  - name: uncovered-fires-on-any-source
    tags: [cli]
    code: [spec-yatsu/src/cli.ts]
    description: >-
      Through the real `spex yatsu scan` in a scratch repo: create a node that governs a NON-frontend
      source file (a backend `.ts`, and — after setting `lint.sourceExtensions: ["rs"]` in spexcode.json
      — a Rust `.rs`) with NO yatsu.md; also a control node governing a `.jsx` file, and a node governing
      only a non-source file (a `.md` / a `.sh` hook). Run `spex yatsu scan` and read the `yatsu-uncovered`
      lines and the summary count.
    expected: >-
      `yatsu-uncovered` fires on ANY node governing a file whose extension is in the configured
      `sourceExtensions` (default ts/tsx/js/jsx) — the backend `.ts` node is flagged, not silently exempt,
      and the frontend control still flags. Configuring `sourceExtensions: ["rs"]` makes the `.rs` node
      flag while the `.ts` node stops. A node governing only a non-source file is never flagged. The
      finding says "governs source code" (not "frontend code"), so a non-web project's loss signal is no
      longer blind to its own sources.
  - name: schema-gate-rejects-malformed
    tags: [cli]
    description: >-
      Through the real `spex` surface, write a yatsu.md with a typo'd field key and a missing
      `expected` into a node dir, then (a) run `spex yatsu scan` and (b) stage it and run
      `spex yatsu check-staged`. File the transcript with
      `spex yatsu eval yatsu-core --scenario schema-gate-rejects-malformed --result <txt> --pass`.
    expected: >-
      scan reports a `yatsu-schema` finding naming each violation (unknown key, missing required
      field) and counts it under "N malformed"; check-staged prints the same violations and exits
      non-zero (blocking the commit), while a well-formed staged yatsu.md exits zero.
  - name: sibling-edit-doesnt-stale
    tags: [cli]
    description: >-
      Through the real `spex yatsu scan`: take a node whose yatsu.md holds several scenarios with fresh
      readings, then commit a change to ONE scenario's block (edit it, or add a brand-new sibling
      scenario) in that yatsu.md, leaving every other scenario's block byte-identical. Re-run
      `spex yatsu scan`.
    expected: >-
      Only the scenario whose OWN block moved (or the newly-added one) is flagged `yatsu-drift` on the
      scenario axis; every sibling whose block was untouched stays fresh. The scenario axis is
      per-scenario, not per-file — a sibling's edit never re-stales this reading, so one yatsu.md's
      routine growth no longer generates a wave of false stale scores.
  - name: dirty-governed-warns-at-filing
    tags: [cli]
    code: [spec-yatsu/src/cli.ts]
    description: >-
      Through the real `spex yatsu` CLI in a scratch repo: leave an UNCOMMITTED edit in a
      scenario's governed code file, run `spex yatsu eval <node> --pass`, then commit that edit
      and re-run `spex yatsu scan`. Also file once following the honest measure→commit→file
      flow: measure on the working tree until green, commit that just-tested tree as-is, THEN
      file the reading against the clean HEAD.
    expected: >-
      eval warns LOUD at filing time — a ⚠ line naming each governed file with uncommitted
      changes and saying the reading is MIS-ANCHORED from birth: codeSha can only name a
      commit, never a working tree, and HEAD does not contain the edits just measured, so the
      reading claims a pass for code that never ran — while still filing it (a warning, never
      a block; retract is the repair). A measure→commit→file reading prints no warning and
      stays fresh on the next scan; the later stale flag on a dirty-tree reading is freshness
      correctly exposing the mis-anchor, not an engine bug.
  - name: retract-undoes-a-botched-filing
    tags: [cli]
    description: >-
      Through the real `spex yatsu` CLI in a scratch repo: file a good reading, then a junk one (a
      simulated botched e2e/smoke run), confirm `show` leads with the junk verdict, then run
      `spex yatsu retract <node> --scenario <s> --note <why>`. Re-run `show` and `scan`; retract
      again until nothing is left, and check the loud error on one retract too many plus the
      unknown-flag rejection. Inspect the sidecar file itself.
    expected: >-
      retract appends a retraction event — no sidecar line is ever deleted or rewritten; the junk
      line stays in the file and `show` renders the ⟲ retracted trace beside the readings. The
      effective scoreboard drops the retracted reading everywhere at once: the prior good reading
      is the latest again (scan quiet), and retracting every reading returns the scenario to
      yatsu-missing. A retract with no un-retracted reading left fails loud, as does an unknown
      flag.
  - name: metadata-sweep-doesnt-stale
    tags: [cli]
    code: [spec-yatsu/src/scenariofresh.ts]
    description: >-
      Through the real `spex yatsu scan` in a scratch repo: file a reading, then commit a
      TAGS-ONLY change to that scenario's block (add/reorder tags — the schema-clean sweep a
      real tree gets), leaving description and expected byte-identical; re-run scan. Then, as
      the control, commit an edit to the same scenario's `expected` and scan again.
    expected: >-
      The tags-only commit records NO scenario change — the reading stays fresh, scan stays
      quiet: routing metadata (tags, and the other non-semantic fields) is outside the
      scenario-freshness projection, so a metadata sweep can't spray false yatsu-drift across
      readings whose measurement contract (description + expected) never moved. The `expected`
      edit still flags yatsu-drift on the scenario axis — the semantic fields keep their teeth.
  - name: off-history-anchor-content-fallback
    tags: [cli]
    code: [spec-yatsu/src/freshness.ts]
    description: >-
      Through the real `spex yatsu scan` in a scratch repo: file a reading, commit the sidecar, then
      squash the history so the reading's codeSha is orphaned (off-history) while the governed code
      file and the scenario's yatsu.md block stay byte-identical; re-run scan. Then squash again WITH
      a real governed edit and scan. Finally expire the reflog and `git gc --prune=now` so the
      orphaned anchor commit object is truly gone, and scan once more.
    expected: >-
      An off-history codeSha alone is not stale: while the orphaned commit object still exists, scan
      falls back to comparing content — byte-identical governed files and an unchanged scenario block
      read fresh, so a fold/rebase/squash/cherry-pick that rewrites history without touching governed
      content raises no yatsu-drift. A genuine governed change still flags the moved axis. Only when
      the anchor commit object is truly gone does the conservative stale remain, reported as the
      anchor axis so it reads as "anchor lost", not "content changed".
  - name: leaf-collision-canonical-id
    tags: [cli]
    description: >-
      Through the real `spex yatsu` CLI in a scratch repo whose .spec tree holds THREE nodes sharing
      one leaf dir name (each with its own yatsu.md): run `spex yatsu show`/`spex yatsu eval` first
      with a node's canonical disambiguated id (the `_`-joined suffix the board/scan print, e.g.
      `a_web-remote-control`), then with the bare colliding leaf name.
    expected: >-
      The canonical disambiguated id — the id every other surface (board, scan, search) speaks —
      resolves to its node: show renders that node's readings and eval files against exactly it,
      never hasYatsu:false. The bare leaf name, ambiguous across several yatsu nodes, fails LOUD
      listing the candidate canonical ids — it never silently picks the first node in walk order.
      A non-colliding leaf keeps working bare, as the convenience it always was.
---
# yatsu.md — yatsu-core

This node's behaviour is measured through the `spex yatsu` CLI itself (YATU): the AGENT files a reading
with no browser and no executor, `scan` reflects freshness derived live from git, and `clean` prunes the
content-addressed cache. yatsu records the measurement and keeps score; it runs nothing.
