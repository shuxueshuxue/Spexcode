---
scenarios:
  - name: edit-tab-no-reload-flash
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and jump (the `/` search) to a node that is mid-change — one with an edit
      overlay, e.g. session-graph — then press `i` to open its info popup. Click the leading "edit"
      tab: the pending unified diff of the node's spec.md (vs the fork point) renders. Now toggle to
      the "spec" tab and back to "edit" a few times. Watch the edit pane on each return: the diff must
      reappear AT ONCE, never blanking to the "loading diff…" placeholder. Screenshot the edit tab
      showing the rendered diff and file it with
      `spex yatsu eval work-pane --scenario edit-tab-no-reload-flash --image <png> --pass`.
    expected: >-
      The edit tab renders the node's pending spec.md diff, and re-selecting the tab after switching
      away shows that diff immediately with no loading-flash — the same instant feel as the history,
      issues and eval tabs. The filed reading carries the screenshot and a pass verdict.
  - name: spec-body-renders-tables
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and drill to a node whose spec body contains a GFM markdown table — e.g.
      `runtime` (spec-cli ▸ sessions ▸ lifecycle ▸ runtime), whose body has the global-store files
      table. Press `i`, then the `spec` tab, and read the body. The `| … |` rows must render as a real
      HTML table — a tinted header row, bordered cells — NOT as a run-together paragraph of pipes. Cell
      text keeps its inline markdown (`` `code` ``, [[links]]). Screenshot the rendered table and file
      it with `spex yatsu eval work-pane --scenario spec-body-renders-tables --image <png> --pass`.
    expected: >-
      A markdown table in a spec body renders as a bordered table with a header row and aligned cells,
      each cell's inline `code` and [[links]] preserved — never the mangled single-paragraph the
      pipe-blind tokenizer used to emit. The filed reading carries the screenshot and a pass verdict.
  - name: info-board-signals
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard, jump (the `/` search) to a node with rich state — e.g. node-graph, a drift
      node that has a yatsu score and governs several files — and press `i`, then the `spec` tab. Read
      the info board: a compact stat bar must carry the node's at-a-glance signals, and the governed
      files must read as a counted row of chips, not a vertical list. Screenshot the spec tab and file
      it with `spex yatsu eval work-pane --scenario info-board-signals --image <png> --pass`.
    expected: >-
      The stat bar shows, left to right, the derived status as a coloured dot + label, the version, the
      aggregate yatsu score badge, a drift count when the node has drifted, and the last-editing session
      pushed to the right — the same signal vocabulary the node tile speaks. Below it the governed files
      render as a `// governs N` count over a wrapping row of file chips. The filed reading carries the
      screenshot and a pass verdict.
  - name: history-per-entry-disclosure
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      Open the dashboard, jump to a node with a long version history (several versions — e.g. the root
      spexcode node or node-graph), press `i` and open the history tab. Record the controls and initial
      disclosure state, click an older row header open and closed, then finish the latest open entry and
      scroll down (or press j/Down at its end) to reveal the next collapsed row. Repeat in the 390px Spec
      Information surface and file the dynamic interaction as video evidence.
    expected: >-
      The latest history entry starts expanded and older entries start collapsed. No expand-all control
      or bulk-expand replacement exists anywhere in Spec Information. Each row header independently
      toggles its own diff, while the normal down gesture reveals one next entry after the current open
      entry has been consumed, at desktop and 390px. The filed reading carries the interaction video and
      a pass verdict.
---
# eval.md — work-pane

The node popup is product surface — measured by **looking** (YATU), not a unit test. The agent drives the
real dashboard: jump to a node mid-change, open its popup, and exercise the edit tab's tab-toggle. The loss
to catch is the inconsistency the other panes don't have — a pane that *reloads* (flashes its loading state)
each time you return to it instead of being instant like the board-fed and memoised tabs beside it.
