---
scenarios:
  - name: one-name-everywhere
    tags: [frontend-e2e, desktop]
    test:
      path: spec-dashboard/test/session-label-one-name-everywhere.e2e.mjs
      name: session list, @ mention dropdown, and Rename prefill
    description: >
      In a real browser on the session board, open a live session's inbox and type `@` to raise the
      mention dropdown. Compare each dropdown row's text against the session LIST rows beside it — the
      same sessions must read as the same title (the live self-summary / derived line), never as the
      bare launch-prompt truncation or a raw URL. Then right-click a session that has a user rename and
      open Rename: the input must prefill with the raw override itself (editable), while every display
      surface shows the derived name.
    expected: >
      Every dropdown row's label equals the derived title the session list shows for that session
      (name > activity > note > promptPreview > …), with zero rows showing a raw URL when prompt prose exists; the rename dialog
      prefills the raw override (the one sanctioned raw consumer). Zero loss = one derivation, every
      surface, and the raw parts reachable only where editing them is the point.
    code:
      - spec-dashboard/src/SessionWindow.jsx#SessionRow
      - spec-dashboard/src/mentions.jsx#matchSessions
      - spec-dashboard/src/SessionContextMenu.jsx#SessionContextMenu
  - name: note-fills-title-fallback
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-note-title.e2e.mjs
    description: >
      Give a live session a human rename, then declare a long lifecycle note. Read its board row, search
      result, and lock hint in a real browser, then open its timeline and inspect the declaration.
    expected: >
      Every title surface still reads the human rename; the note is readable in the timeline and supplies the
      row/tab/search/lock-hint title only after the rename and live activity are absent. Clearing the rename
      falls back to live activity, then note, then meaningful prompt prose. Zero loss = one title chain.
    code: [spec-cli/src/sessionLabel.test.ts]
    related: [spec-cli/src/sessions.ts, spec-dashboard/src/SessionWindow.jsx]
  - name: cli-identity-consistency
    tags: [cli]
    description: >
      Take ONE live session whose stable selector `label` differs from its derived `title`. Read it through
      `spex session ls`, `show`, and `review`; provoke a selector ambiguity that includes it; and follow a
      launched/state/message event for it. Compare each visible session name with the Session's `--json`
      `title` field.
    expected: >
      Every human-readable CLI identity — list row, show/review header, ambiguity candidate, and
      launch/state/message notification — displays the same derived `title` as the Session JSON, never its
      stable `label`, raw node, or branch. `label` and `node` remain readable only as machine-compatible JSON
      fields and selector inputs. Zero loss = one current session name across the dashboard and CLI.
    code: [spec-cli/src/cli.ts, spec-cli/src/session-follow.ts]
    related: [spec-cli/src/sessions.ts]
---

# session-label — measurement

YATU: the loss is a session reading as two different names on one screen, or a raw URL obscuring prompt prose.
Measure the board title surfaces together in a real browser, compare a declaration in Timeline, and
verify the rename dialog's prefill; the wire-shape and precedence halves are pinned by the unit test.

For the CLI identity scenario, drive the real CLI against one session whose `label` and `title` differ. The
transcript must show the same wire-derived title in every human-readable command and follow notification;
the JSON `label`/`node` fields are retained only to prove that selector compatibility did not become a second
visible-name path.
