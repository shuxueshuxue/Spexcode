---
scenarios:
  - name: edit-tab-no-reload-flash
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
---
# yatsu.md — work-pane

The node popup is product surface — measured by **looking** (YATU), not a unit test. The agent drives the
real dashboard: jump to a node mid-change, open its popup, and exercise the edit tab's tab-toggle. The loss
to catch is the inconsistency the other panes don't have — a pane that *reloads* (flashes its loading state)
each time you return to it instead of being instant like the board-fed and memoised tabs beside it.
