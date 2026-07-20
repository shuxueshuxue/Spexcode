---
scenarios:
  - name: headline-is-self-summary
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard with at least one live WORKING session (its tmux pane title set) and look at the
      top-left session window (expand any nest fold to reveal dispatched workers). Read each live row: it is
      the COMPACT ONE-LINE face — the avatar, then the session's HEADLINE — the worker's OWN live tmux
      self-summary (its pane title), single-line with an ellipsis — NOT the node name, branch, or the few
      words the human typed at launch — with the colour-coded status GLYPH (the word on its hover tip, e.g.
      `working`) and the op tally folded inline on that same line, never a second row. A session that has not
      come up yet (queued / booting, no pane title) shows its launch-prompt placeholder as its headline
      instead, same one-line face. Crucially, watch a session through its FIRST seconds of coming up: the
      headline must hold the launch-prompt placeholder steadily and then switch ONCE to the agent's glyph-led
      self-summary — it must NOT flicker through tmux's default pane title (the host name, e.g.
      `ser581555022561`) or a bare `Claude Code` splash on the way, because a genuine self-summary always
      leads with a status glyph and a glyph-less title is rejected as "not spoken yet". Screenshot it and file
      with `spex eval add session-activity --scenario headline-is-self-summary --image <png> --pass`.
    expected: >-
      A live working session's row is ONE compact line whose headline is its tmux self-summary — the agent's
      own description of what it is doing now, having overridden the launch-prompt placeholder it started
      with; the status rides that same line as a colour-coded glyph (`STATUS_GLYPH`/`STATUS_COLOR`, the exact
      word on the hover title) with the op tally beside it — no second status row on ANY list (the old
      two-row face is deleted outright). A not-yet-live row shows the prompt placeholder as its headline, same
      single line. A just-booting row keeps that placeholder until the agent's glyph-led summary lands — it
      never flashes the host name or a bare `Claude Code` splash in between. The headline is the worker's own
      pane title (or, when present, a human rename), never a bare derived label or tmux default while the
      agent is up.
    code:
      - spec-cli/src/sessions.ts
      - spec-dashboard/src/SessionWindow.jsx
  - name: console-header-matches-headline
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
    description: >-
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE WORKING
      session whose tmux pane title (self-summary) is set, so its headline is the agent's own live line —
      visibly NOT the bare node name. Read the selected left-sidebar row and the toolbar's `si-th-name`
      identity beside the lifecycle/liveness state; compare their DOM text verbatim. At 1440px the toolbar
      uses the free width, then repeat with a deliberately long headline in a 390px terminal pane and confirm
      only the rendered width ellipses — the accessible identity keeps the full shared line and state.
      The stable handle (node/branch/id) appears nowhere as a console title. Screenshot the console sidebar
      beside the toolbar and file with `spex eval add session-activity --scenario
      console-header-matches-headline --image <png> --pass`.
    expected: >-
      The toolbar's identity and selected sidebar row are the SAME `sessionHeadline` string: the worker's live
      tmux self-summary (its pane title), a launch-prompt placeholder only before the agent is up, a human
      rename always winning — never the stable node/branch name. The toolbar derives no second fallback chain;
      it spends otherwise-free width and ellipses before Eval/commands when tight, while its named AX group
      retains the full headline plus lifecycle/liveness. A turn that retitles the board row retitles sidebar
      and toolbar in lock-step.
    code:
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/session.js
      - spec-dashboard/src/styles.css
  - name: codex-headline-is-task-not-folder
    tags: [frontend-e2e, desktop]
    description: >-
      Launch a CODEX session into a worktree whose folder name differs from the task (e.g. branch
      `node/codex-naming` → worktree folder `codex-naming`, task "Implement codex session naming"). Codex sets
      its tmux pane title to a spinner glyph + the cwd BASENAME (`⠙ codex-naming`), not a task summary. Open
      the dashboard and read that session's Row-1 headline (and the Enter console toolbar identity). It must be the
      TASK — the launch-prompt preview — NOT the worktree folder name `codex-naming`. Contrast a CLAUDE
      session in the same view: its headline IS its live pane-title self-summary, unchanged. Screenshot both
      rows and file with `spex eval add session-activity --scenario codex-headline-is-task-not-folder --image <png> --pass`.
    expected: >-
      The codex row's headline is its launch-prompt task, never the worktree folder name its pane title
      carries — because codex's pane title is NOT a self-summary (the harness declares
      `paneTitleIsSelfSummary: false`), so `activity` is suppressed and the headline falls through to the
      prompt preview. The claude row is unaffected: its headline is still its own live tmux self-summary. One
      harness capability decides which side of the fork a session lands on; neither harness shows a folder name
      as a headline.
    code:
      - spec-cli/src/sessions.ts
      - spec-cli/src/harness.ts
  - name: search-and-lock-hint-match-the-board-headline
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, read the session names the human sees on the SESSION
      BOARD — the top-left window rows (`.sess-id`), where a live worker shows its self-summary headline, NOT
      its raw node/branch/id. Then open the search palette (⌘/Ctrl+/ over the session board, or `/` on the
      board) and read the SESSION rows' titles. Compare them to the board headlines. Also lock a session
      (single-click its window row) and read the lock-hint banner's name. Finally, type a fragment of a
      session's LABEL (the server-derived stable name — a human rename or the prompt truncation) into the
      palette and confirm that session matches.
      Screenshot the board window beside the open palette.
    expected: >-
      Every session reads as ONE name across surfaces: each board-window headline appears verbatim as that
      session's title in the search palette, and the lock-hint banner shows the same headline — the palette
      and lock banner no longer show the raw stable handle (node/branch/id) while the board shows the live
      self-summary. A human rename still wins everywhere. Search matches the server-derived label (which
      carries a rename name or the prompt truncation); raw id/node/branch fragments are deliberately NOT
      promised to match — a zero-result id query is compliant behaviour, not a regression. The place a
      session is searched from and the place it is found never disagree.
    code:
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/App.jsx
  - name: headline-reveals-on-demand
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, open the session console (Enter) and look at the left
      session list, which is deliberately NARROW so it doesn't steal width from the terminal beside it — so
      long headlines ellipse at rest. Confirm every row is a dense single line. Now HOVER a truncated row and
      confirm it does NOT expand (only its background tints) — hover must leave the list geometry stable. Then
      CLICK a row whose headline is truncated to select it, and confirm it un-truncates. Read its marker (the
      status glyph + op tally) and the wrapped headline. Include a parent row with a subtree-count fold pod,
      and compare the pod-to-headline spacing before and after selecting it. Record the list from rest through
      hover and selection, with timeline steps for those states, showing the selected expanded row beside its
      still-single-line neighbours.
    expected: >-
      At rest each row is one line with an ellipsis (a dense index). Hovering does NOT expand a row — reveal is
      tied to SELECTION, so the list stays a stable click surface and rows never shift under the cursor. The
      row you SELECT un-truncates: its headline wraps to the FULL text in place while every other row stays
      single-line, so any title is completely readable without widening the list. On the wrapped row the small
      markers (status glyph + op tally) sit pinned to the headline's FIRST line (top-right), not down a column,
      so the wrapped lines below them run the full row width. A selected parent keeps the same natural gap
      between its subtree-count fold pod and the headline as it had at rest; the count and first title word
      never touch when selection switches the row into block flow.
    code:
      - spec-dashboard/src/styles.css
---
# eval.md — session-activity

Product surface, measured by **looking** (YATU): the agent screenshots the rendered session window and
confirms each live row is the compact one-line face whose headline is the worker's pane-title self-summary
(the launch-prompt placeholder showing only before the agent is up), with the status folded to an inline
colour-coded glyph and the op tally beside it — filing it as a reading with image evidence and a verdict.
The on-demand headline reveal is measured as a browser interaction video with a timeline because its resting,
hovered, and selected states are the behavior under test.
The scenario scopes its freshness `code:` to the capture (`sessions.ts`) and the render
(`SessionWindow.jsx`) — not the shared stylesheet — so an unrelated CSS edit elsewhere doesn't stale this
reading.
