---
scenarios:
  - name: rename-overrides-and-clears
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session console (Enter), right-click a
      session row, and pick "rename" — a centred prompt opens prefilled with the current override (blank if
      none). Type a new display name and submit. Watch the row's label across the console list (and the
      top-left window glance, same precedence). Then right-click the same row, rename again, clear the field
      to blank, and submit. Screenshot the row label before, after the rename, and after the blank-clear.
    expected: |
      Submitting a name immediately relabels the session everywhere it is named — the console tab/list and
      the top-left window both read the new name (it wins at the top of the `name ▸ node ▸ title ▸ branch ▸
      id` precedence), because every surface reads that one shared precedence after the board reload. A blank
      name is a RESET, not an error: it clears the override and the row falls back to its derived label
      (node/title/branch/id). The rename never edits the live terminal — a session in any state is renamable.
  - name: rename-prompt-titles-by-headline
    tags: [frontend-e2e, desktop]
    description: >
      Open the console, right-click a session row whose label comes from its live activity (no human rename,
      so its headline differs from its node/branch handle), and pick "rename" to raise the prompt. Read the
      prompt's title and compare it to that row's headline in the left session list. Cancel —
      never submit.
    expected: >
      The rename prompt's title shows the SAME headline as the row the human right-clicked (the session's
      activity/description, not its node/branch handle). The terminal toolbar deliberately repeats no identity;
      its accessible names contain no headline payload. The input still prefills with the raw `name` override
      (blank when none is set), not the headline.
  - name: close-confirm-titles-by-headline
    tags: [frontend-e2e, desktop]
    description: >
      Open the console, right-click a session row whose label comes from its live activity (no human rename),
      and pick "close" to raise the confirm. Read the confirm's title and compare it to that row's card
      headline in the left session list. Press Escape to dismiss — never confirm the removal.
    expected: >
      The confirm's title shows the SAME headline as the row (the session's activity/description, not its
      node/branch handle), so the human reads the very words they right-clicked; the terminal toolbar remains
      free of duplicate identity text.
  - name: close-confirm-removes-row
    test: spec-dashboard/test/session-close-freshness.e2e.mjs
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the console (Enter), right-click a session row,
      and pick "close". A confirm prompt (the shared modal, its commit button styled as the destructive
      verb) must appear FIRST — close is not a one-click action on the menu. Press cancel and confirm the row
      is untouched; then right-click → close → press Enter and watch the row. Screenshot the confirm prompt
      and the list after confirming.
    expected: |
      Picking "close" opens a confirm prompt rather than closing immediately (a right-click is easy to
      mis-aim and the worktree removal is destructive). Cancelling does nothing — the row stays. Confirming
      **dismisses the confirm dialog instantly** — it never sits open, frozen and disabled, while the
      removal runs — and fires the human-only worktree removal in the background; the board reload when it
      lands drops the closed row from the working forest while the selected routed document remains open as
      the archived/offline read-only Conversation. This is the same removal the (now-absent) header close once
      did, behind a guard.
      The confirm action has focus on open, so plain Enter is that same confirmation rather than an inert key
      or an activation behind the dialog.
  - name: archive-confirm-with-enter
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, right-click an ordinary session row and pick
      "archive". Verify that no archive request has been sent before confirmation, then press Enter while the
      archive dialog is visible and observe the outgoing request and the dismissed dialog.
    expected: >
      Archive remains behind its confirmation boundary: opening the dialog causes no lifecycle request. The
      archive commit action has focus on open, so one plain Enter dismisses the dialog and sends exactly one
      POST to that row's archive endpoint; Escape, Cancel, and a backdrop click still send none.
  - name: close-refusal-is-visible
    tags: [frontend-e2e, backend-api, desktop]
    description: >
      Through the running dashboard's real session-row close confirm, exercise a target whose backend close
      guard refuses to commit in an isolated governed fixture. Capture the network response and the selected row
      after the refusal.
    expected: >
      The close request is non-2xx with a structured diagnostic, the row remains present, and the dashboard
      renders that diagnostic once through its action-error surface. A refused destructive operation never reads as
      HTTP success or silently disappears.
    code:
      - spec-cli/src/index.ts
      - spec-dashboard/src/SessionContextMenu.jsx#SessionContextMenu
      - spec-dashboard/src/SessionInterface.jsx#SessionInterface
  - name: spec-related-door-lists-the-session-s-nodes
    tags: [frontend-e2e, desktop, backend-api]
    code: spec-dashboard/src/SessionContextMenu.jsx
    related: [spec-dashboard/src/ContextMenu.jsx, spec-dashboard/src/session.js]
    description: >-
      With a live worktree whose pending ops touch spec nodes, right-click that session — its tab, its dock
      row, or its document tools button — and read the menu. Hover the spec entry, read the panel that
      opens beside it, activate one node row, then reopen and activate the panel's last row.
    expected: >-
      The menu carries no `lock on graph` command. Its spec entry is a DOOR: it declares `aria-haspopup`,
      flips `aria-expanded` on hover, and opens a panel that is laid out beside the menu rather than clipped
      away by the menu's own overflow. The panel lists the nodes this session's pending ops touch, capped,
      with what the cap held back said in a quiet non-pressable line. Each row LEADS WITH ITS OP — the
      board's own overlay glyph, not one repeated icon — and that glyph is hidden from assistive technology
      while the row's accessible name carries the node plus the op in words. Activating a node row opens that node's
      `#/spec/<id>` document. The panel's LAST row is fixed — `find on graph` — and it still does exactly
      what the old lock did: the board spotlights this session's changed nodes and its banner offers the
      o / O walk through them.

---

# session-rename — yatsu

Measure through the **real session-row right-click menu**, YATU-style: open the console with `Enter`,
right-click an actual row, and drive the real rename prompt / close confirm — never a direct
`POST /api/sessions/:id/rename` or `/close`, and never an internal label helper. The loss is the two
contracts this node owns: a **rename** is a persisted display override that wins at the top of the shared
label precedence on every surface and that a **blank** value clears back to the derived label; and **close**
is the one human-only worktree removal, reachable only here and only **behind a confirm**. The tab-fallback
landing after a close (where the view goes) is [[session-console]]'s scenario, not this one.
