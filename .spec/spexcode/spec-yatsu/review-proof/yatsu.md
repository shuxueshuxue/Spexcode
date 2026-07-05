---
scenarios:
  - name: proof-renders
    tags: [frontend-e2e, desktop]
    description: >
      Open a session's Eval tab in the console (the right pane's Terminal/Eval pair) in a real browser and
      read the DOM: the gates strip, the row list (blind spots vs measured, in-session vs earlier), where
      evidence bytes load, and the export link. Then follow the `export ↗` link and check the self-contained
      HTML still renders whole (masthead, gates, evidence inlined, diff drill-down).
    expected: |
      The Eval tab shows the gates strip (lint · merge · ahead · committed, the spex-review numbers) and
      COLLAPSED scenario rows grouped by changed node — blind spots lead with the empty ring, then this
      session's own readings ✦-marked and newest-first, then the inherited baseline under its divider;
      the ✦ count chip narrows to the session's own. NO evidence bytes load with the list (rows are
      tier-1 JSON; the blob request happens only when a row is selected and the shared annotator detail
      opens). The `export ↗` link serves the self-contained export HTML: derived masthead, gate row,
      inlined evidence, per-file diff drill-down — whole, not garbled.
  - name: session-attribution-legible
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionEval.jsx, spec-yatsu/src/proof.ts]
    description: >
      Open the Eval tab of a session that filed a reading WITHOUT committing code (its codeSha is the
      merge-base) over a node carrying older readings by other sessions plus a retired scenario's residual
      reading. Read the rows in a real browser: verdict marks, the ✦ session attribution, the divider, the
      count chip, and whether the retired scenario shows.
    expected: >
      Every measured row carries its ✓/✗ verdict mark (muted when stale). The session's own reading is
      ✦-marked and leads its group even when the session has no code commits (a reading is the session's
      own when IT filed it, not only when its codeSha is a branch commit), and the ✦ count chip is present
      to narrow to those. Inherited rows (other sessions' latest readings) sit below an explicit divider
      naming them, so the session's own work and the inherited baseline can never be misread as one. A
      retired scenario (declared in no yatsu.md) contributes NO row — the tab is bounded by declared
      scenarios, the same latest-per-scenario computation every eval face reads.
  - name: eval-tab-shared-shell
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionEval.jsx, spec-dashboard/src/EvalsPage.jsx]
    description: >
      Open a session's Eval tab in a real browser and read the master-detail's DOM against the Evals
      page's: is the shell the SAME component family (`.fv-master` / `.fv-list-col` / `.fv-detail` — no
      `.se-master`/`.se-list`/`.se-detail` clone)? Click the fold toggle and re-measure the columns;
      unfold. Press j/k (focus not in an input) and read whether the selection walks the rows and the
      detail follows, exactly as on #/evals.
    expected: >
      The Eval tab's master-detail IS the shared shell ([[evals-view]]'s EvalMasterDetail): the same
      .fv-master grid with the slim .fv-list-col left (gates strip riding above, session-scoped groups
      inside) and the full-height .fv-detail right, the same fold-to-a-strip toggle (fold collapses the
      list, the strip unfolds it, selection intact), and the same j/k walk (selection moves through blind
      + measured rows, the detail pane follows; a key typed into an input or the terminal's textarea is
      never captured). No session-only shell classes remain. Zero loss = one shell, two homes — the
      session tab can never drift from the Evals page on geometry, fold, or keys.
---
# review-proof loss

YATU through the real console: a session with real changes + readings, the Eval tab read from the live
DOM (rows, gates, request waterfall — the tier check is a NETWORK assertion), and the export artifact
opened as a plain document. Never asserted from the engine code.
