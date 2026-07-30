---
scenarios:
  - name: one-name-everywhere
    tags: [frontend-e2e, desktop]
    description: >
      In a real browser on the session board, open a live session's inbox and type `@` to raise the
      mention dropdown. Compare each dropdown row's text against the session LIST rows beside it — the
      same sessions must read as the same headline (the live self-summary / derived label), never as the
      bare launch-prompt truncation or a raw URL. Then right-click a session that has a user rename and
      open Rename: the input must prefill with the raw override itself (editable), while every display
      surface shows the derived name.
    expected: >
      Every dropdown row's label equals the derived headline the session list shows for that session
      (name > activity > promptPreview > …), with zero rows showing a bare title; the rename dialog
      prefills the raw override (the one sanctioned raw consumer). Zero loss = one derivation, every
      surface, and the raw parts reachable only where editing them is the point.
    code: [spec-cli/src/sessionLabel.test.ts]
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/SessionContextMenu.jsx, spec-dashboard/src/session.js]
  - name: note-never-replaces-title
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-note-title.e2e.mjs
    description: >
      Give a live session a human rename, then declare a long lifecycle note. Read its board row, search
      result, and lock hint in a real browser, then open its timeline and inspect the declaration.
    expected: >
      Every title surface still reads the human rename; the note is readable in the timeline as declaration
      prose and never becomes a row, tab, search, or lock-hint title. Clearing the rename falls back to the
      live activity or prompt title, still never the note. Zero loss = lifecycle state cannot rename a session.
    code: [spec-cli/src/sessionLabel.test.ts]
    related: [spec-cli/src/sessions.ts, spec-dashboard/src/SessionWindow.jsx]
  - name: cli-identity-consistency
    tags: [cli]
    description: >
      Take ONE node-less session (name set from its prompt, empty node, an auto branch like
      `node/spec-cli-3ec0`) and name it through two different CLI surfaces: `spex session ls` and
      `spex session review <id>`. Both are "who is this session" displays and must agree.
    expected: >
      `spex session ls` and `spex session review` show the SAME identity for the session — the derived
      label (its name),
      never one showing the name while the other falls back to the raw branch. Zero loss = the review
      surface reads a `deriveLabel`-produced field, not its own re-inlined `node||branch||id` chain.
    code: [spec-cli/src/cli.ts, spec-cli/src/sessions.ts]
---

# session-label — measurement

YATU: the loss is a session reading as two different names on one screen, or a lifecycle note replacing a
title. Measure the board title surfaces together in a real browser, compare a declaration in Timeline, and
verify the rename dialog's prefill; the wire-shape and precedence halves are pinned by the unit test.
