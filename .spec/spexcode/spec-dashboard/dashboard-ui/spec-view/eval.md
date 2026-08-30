---
scenarios:
  - name: prose-only-file-chips
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Through a real browser, open a spec node with governed files and attachments. Capture the settled
      spec document before any chip click, then click a governed chip and inspect the route and tab strip;
      click a second chip, and finally alt-click the file tab. File the before/after screenshots with
      `spex eval add spec-view --scenario prose-only-file-chips --image <png> --pass`.
    expected: >-
      The initial spec document is full-width prose with no `.specview-code`, no automatic source reader,
      no split divider, and no `spex.docSplit` storage key. A chip is a real `#/file/<path>` link: its file
      tab is focused while the spec tab remains in the working set. A second chip changes the same file
      slot rather than stacking a duplicate, and alt-click still sends that file document to the shell's
      second pane. Attachment chips use the `.spec/<node>/<name>` logical file address and remain readable
      through their node-owned API gate.
  - name: document-menu-crosses-to-the-editing-session
    tags: [frontend-e2e, desktop, backend-api]
    code: spec-dashboard/src/ProseActions.jsx
    related: [spec-dashboard/src/session.js, spec-dashboard/src/NodeContextMenu.jsx]
    description: >-
      With a live worktree whose pending ops touch a node, open that node as a document at `#/spec/<id>` —
      the address an inline `[[id]]` reference resolves to — select nothing, and right-click the prose.
      Read the node action menu that opens, then activate the row for the overlaying session.
    expected: >-
      Below the node's own two verbs the menu lists one shared session-picker row per session currently
      changing this node, resolved by the same overlay join the graph tile menu uses, and its listbox
      carries a real accessible name rather than a raw translation key. Activating a row dismisses the menu
      and lands on that session's `#/sessions/<id>` document, so a reader who arrived by a reference is
      never at a dead end. A node no worktree is changing shows the two verbs alone.

---
# eval.md - spec-view

Measure the document boundary and file-chip handoff through the real browser. The scenario deliberately
checks the absence of the old split before checking the new address, so a source pane that merely moved
elsewhere cannot pass.
