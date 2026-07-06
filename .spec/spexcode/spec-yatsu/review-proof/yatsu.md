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
  - name: eval-cli-read
    tags: [cli]
    code: [spec-cli/src/cli.ts, spec-cli/src/client.ts, spec-cli/src/help.ts]
    description: >
      Drive the real CLI against a live backend: `spex eval <SEL>` on a session with committed changes
      and readings, on a session with an empty diff, and with --json; `spex eval <SEL> --export` and the
      old `spex review proof <SEL>` spelling; the help probes (`spex help eval`, `spex eval <SEL> --help`,
      `spex help review`, the `spex help` map). Capture stdout/stderr + exit codes as the transcript.
    expected: >
      `spex eval <SEL>` renders the /evals model as text in the tab's attention order — gates strip, a ✦
      legend when the session filed its own readings, per changed node: blind spots lead, ✦-marked own
      readings, then the inherited baseline under a named divider; an empty diff prints a clean
      nothing-to-evaluate line; --json dumps the model. --export writes the self-contained HTML path (its
      --json = the model). `spex review proof` still works but echoes the canonical `spex eval <SEL>
      --export` deprecation line on stderr. Help: the map lists eval beside review, `spex help review` no
      longer carries a proof sub-noun, and an --help probe never fires the verb.

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
  - name: eval-tab-text-selection
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/SessionEval.jsx]
    description: >
      Open a session's Eval tab and the top-level Evals page in a real browser. In each, drag-select
      visible eval detail text such as the expected paragraph or scenario title, and inspect the
      mousedown event/default behavior plus `window.getSelection()`.
    expected: >
      Text in the session Eval tab selects like text in the top-level Evals page. The session console's
      focus-retention mousedown handler does not preventDefault inside the Eval workspace, a drag creates
      a non-empty browser selection, and ordinary Eval-tab buttons/row selection still work. No page
      errors.
---
# review-proof loss

YATU through the real console: a session with real changes + readings, the Eval tab read from the live
DOM (rows, gates, request waterfall — the tier check is a NETWORK assertion), and the export artifact
opened as a plain document. Never asserted from the engine code.
